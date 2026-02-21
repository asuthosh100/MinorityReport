import { NextRequest } from "next/server";
import { inputOrchestrator } from "@/lib/orchestrator/input";
import { escrowFromAgent, distributeRewards } from "@/lib/kite/transactions";
import { runVerification } from "@/lib/verifier/claude";
import { ESCROW_AMOUNT } from "@/lib/kite/config";
import {
  checkRateLimit,
  checkSpendingCap,
  recordSpending,
  preflightBalanceCheck,
  getSpendingState,
} from "@/lib/x402/security";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { query } = body;

  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ error: "A query string is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limit check (before opening SSE stream)
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs || 0) / 1000)}s (max 10 requests/min).`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((rateCheck.retryAfterMs || 0) / 1000)),
        },
      }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(type: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`)
        );
      }

      try {
        // --- Security: Spending cap check ---
        send("security", {
          phase: "spending_cap",
          status: "checking",
          message: "Checking spending caps...",
          spending: getSpendingState(),
        });

        const capA = checkSpendingCap("A");
        const capB = checkSpendingCap("B");

        if (!capA.allowed || !capB.allowed) {
          send("security", {
            phase: "spending_cap",
            status: "blocked",
            message: !capA.allowed
              ? `Agent A hit spending cap: ${capA.spent.toFixed(4)} / ${capA.cap} KITE`
              : `Agent B hit spending cap: ${capB.spent.toFixed(4)} / ${capB.cap} KITE`,
            spending: getSpendingState(),
          });
          send("error", {
            message: `Spending cap reached. Reset requires server restart.`,
          });
          return;
        }

        send("security", {
          phase: "spending_cap",
          status: "passed",
          message: `Spending caps OK — A: ${capA.spent.toFixed(4)}/${capA.cap} KITE | B: ${capB.spent.toFixed(4)}/${capB.cap} KITE`,
          spending: getSpendingState(),
        });

        // --- Security: Pre-flight balance check ---
        send("security", {
          phase: "balance_check",
          status: "checking",
          message: "Checking on-chain balances...",
          spending: getSpendingState(),
        });

        const [balA, balB] = await Promise.all([
          preflightBalanceCheck("A"),
          preflightBalanceCheck("B"),
        ]);

        if (!balA.ok || !balB.ok) {
          const err = !balA.ok ? balA.error : balB.error;
          send("security", {
            phase: "balance_check",
            status: "blocked",
            message: err || "Balance check failed",
            balances: { A: { kite: balA.kite, usdt: balA.usdt }, B: { kite: balB.kite, usdt: balB.usdt } },
            spending: getSpendingState(),
          });
          send("error", { message: err || "Balance check failed" });
          return;
        }

        send("security", {
          phase: "balance_check",
          status: "passed",
          message: `Balances OK — A: ${parseFloat(balA.kite).toFixed(4)} KITE | B: ${parseFloat(balB.kite).toFixed(4)} KITE`,
          balances: { A: { kite: balA.kite, usdt: balA.usdt }, B: { kite: balB.kite, usdt: balB.usdt } },
          spending: getSpendingState(),
        });

        // --- Security: Escrow ---
        send("security", {
          phase: "escrow",
          status: "checking",
          message: `Escrowing ${ESCROW_AMOUNT} KITE from each agent...`,
          spending: getSpendingState(),
        });

        const [escrowA, escrowB] = await Promise.allSettled([
          escrowFromAgent("A"),
          escrowFromAgent("B"),
        ]);

        const escrowAResult = escrowA.status === "fulfilled" ? escrowA.value : { success: false, error: String(escrowA.reason) };
        const escrowBResult = escrowB.status === "fulfilled" ? escrowB.value : { success: false, error: String(escrowB.reason) };

        if (!escrowAResult.success || !escrowBResult.success) {
          send("security", {
            phase: "escrow",
            status: "blocked",
            message: "Escrow failed — query aborted",
            escrows: { A: escrowAResult, B: escrowBResult },
            spending: getSpendingState(),
          });
          send("error", {
            message: "Escrow failed. Both agents must escrow before proceeding.",
          });
          return;
        }

        // Record spending after successful escrow
        const escrowAmount = parseFloat(ESCROW_AMOUNT);
        recordSpending("A", escrowAmount);
        recordSpending("B", escrowAmount);

        send("security", {
          phase: "escrow",
          status: "passed",
          message: `Both agents escrowed ${ESCROW_AMOUNT} KITE`,
          escrows: { A: escrowAResult, B: escrowBResult },
          spending: getSpendingState(),
        });

        // Step 2: Query models
        send("step", { message: "Querying Agent A (OpenAI gpt-4o-mini)..." });
        send("step", { message: "Querying Agent B (Gemini 2.0 Flash)..." });

        const individualResponses = await inputOrchestrator(query);

        send("step", {
          message: individualResponses.openai.error
            ? `Agent A failed: ${individualResponses.openai.error}`
            : `Agent A responded (${individualResponses.openai.content.length} chars)`,
        });
        send("step", {
          message: individualResponses.gemini.error
            ? `Agent B failed: ${individualResponses.gemini.error}`
            : `Agent B responded (${individualResponses.gemini.content.length} chars)`,
        });

        // Step 3: Verify
        send("step", { message: "Extracting verifiable claims from both responses..." });

        const verification = await runVerification(
          query,
          individualResponses.openai.content || "",
          individualResponses.gemini.content || ""
        );

        const totalClaims = verification.claims.allClaims.length;
        const novelCount = verification.claims.novelInsights.length;
        send("step", {
          message: `Verification complete: ${totalClaims} claims classified, ${novelCount} novel insights found`,
        });
        send("step", {
          message: `VeriScore — Agent A: ${Math.round(verification.scores.agentA.veriScore * 100)}% | Agent B: ${Math.round(verification.scores.agentB.veriScore * 100)}%`,
        });
        send("step", {
          message: `Winner: Agent ${verification.claims.winner} (${verification.claims.winner === "A" ? "OpenAI" : "Gemini"})`,
        });

        // Step 4: Reward
        send("step", { message: `Distributing rewards to Agent ${verification.claims.winner}...` });

        let reward = null;
        try {
          reward = await distributeRewards(verification.claims.winner);
          send("step", {
            message: reward.winnerTx.success
              ? `Agent ${verification.claims.winner} rewarded ${reward.winnerAmount} KITE (tx: ${reward.winnerTx.transactionHash?.slice(0, 10)}...)`
              : `Reward failed: ${reward.winnerTx.error}`,
          });
          send("step", { message: `Verifier kept ${reward.verifierCut} KITE as fee` });
        } catch (error) {
          reward = { winnerTx: { success: false, error: String(error) }, verifierCut: "0", winnerAmount: "0" };
          send("step", { message: `Reward distribution failed: ${error}` });
        }

        // Final result
        send("result", {
          verification,
          transactions: { escrowA: escrowAResult, escrowB: escrowBResult, reward },
          individualResponses,
        });
      } catch (error) {
        send("error", { message: String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
