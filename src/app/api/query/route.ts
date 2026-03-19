export const maxDuration = 300;

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
import { AGENT_NAMES } from "@/lib/types";
import { isDemoQuery, getDemoResponses, getDemoVerification } from "@/lib/demo";

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
        const capC = checkSpendingCap("C");

        if (!capA.allowed || !capB.allowed || !capC.allowed) {
          const blocked = !capA.allowed ? capA : !capB.allowed ? capB : capC;
          const blockedAgent = !capA.allowed ? "A" : !capB.allowed ? "B" : "C";
          send("security", {
            phase: "spending_cap",
            status: "blocked",
            message: `Agent ${blockedAgent} hit spending cap: ${blocked.spent.toFixed(4)} / ${blocked.cap} KITE`,
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
          message: `Spending caps OK — A: ${capA.spent.toFixed(4)}/${capA.cap} KITE | B: ${capB.spent.toFixed(4)}/${capB.cap} KITE | C: ${capC.spent.toFixed(4)}/${capC.cap} KITE`,
          spending: getSpendingState(),
        });

        // --- Security: Pre-flight balance check ---
        send("security", {
          phase: "balance_check",
          status: "checking",
          message: "Checking on-chain balances...",
          spending: getSpendingState(),
        });

        const [balA, balB, balC] = await Promise.all([
          preflightBalanceCheck("A"),
          preflightBalanceCheck("B"),
          preflightBalanceCheck("C"),
        ]);

        if (!balA.ok || !balB.ok || !balC.ok) {
          const err = !balA.ok ? balA.error : !balB.ok ? balB.error : balC.error;
          send("security", {
            phase: "balance_check",
            status: "blocked",
            message: err || "Balance check failed",
            balances: {
              A: { kite: balA.kite, usdt: balA.usdt },
              B: { kite: balB.kite, usdt: balB.usdt },
              C: { kite: balC.kite, usdt: balC.usdt },
            },
            spending: getSpendingState(),
          });
          send("error", { message: err || "Balance check failed" });
          return;
        }

        send("security", {
          phase: "balance_check",
          status: "passed",
          message: `Balances OK — A: ${parseFloat(balA.kite).toFixed(4)} KITE | B: ${parseFloat(balB.kite).toFixed(4)} KITE | C: ${parseFloat(balC.kite).toFixed(4)} KITE`,
          balances: {
            A: { kite: balA.kite, usdt: balA.usdt },
            B: { kite: balB.kite, usdt: balB.usdt },
            C: { kite: balC.kite, usdt: balC.usdt },
          },
          spending: getSpendingState(),
        });

        // --- Security: Escrow ---
        send("security", {
          phase: "escrow",
          status: "checking",
          message: `Escrowing ${ESCROW_AMOUNT} KITE from each agent...`,
          spending: getSpendingState(),
        });

        const [escrowA, escrowB, escrowC] = await Promise.allSettled([
          escrowFromAgent("A"),
          escrowFromAgent("B"),
          escrowFromAgent("C"),
        ]);

        const escrowAResult = escrowA.status === "fulfilled" ? escrowA.value : { success: false, error: String(escrowA.reason) };
        const escrowBResult = escrowB.status === "fulfilled" ? escrowB.value : { success: false, error: String(escrowB.reason) };
        const escrowCResult = escrowC.status === "fulfilled" ? escrowC.value : { success: false, error: String(escrowC.reason) };

        if (!escrowAResult.success || !escrowBResult.success || !escrowCResult.success) {
          send("security", {
            phase: "escrow",
            status: "blocked",
            message: "Escrow failed — query aborted",
            escrows: { A: escrowAResult, B: escrowBResult, C: escrowCResult },
            spending: getSpendingState(),
          });
          send("error", {
            message: "Escrow failed. All agents must escrow before proceeding.",
          });
          return;
        }

        // Record spending after successful escrow
        const escrowAmount = parseFloat(ESCROW_AMOUNT);
        recordSpending("A", escrowAmount);
        recordSpending("B", escrowAmount);
        recordSpending("C", escrowAmount);

        send("security", {
          phase: "escrow",
          status: "passed",
          message: `All agents escrowed ${ESCROW_AMOUNT} KITE`,
          escrows: { A: escrowAResult, B: escrowBResult, C: escrowCResult },
          spending: getSpendingState(),
        });

        // Check if this is a demo query (Wizard of Oz mode)
        const demoMode = isDemoQuery(query);

        // Helper for staggered demo delays (randomised so it feels organic)
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms + Math.random() * ms * 0.3));

        // Step 2: Query models  (~9s total in demo)
        send("step", { message: "Querying Agent A (OpenAI gpt-4o-mini)..." });
        if (demoMode) await wait(500);
        send("step", { message: "Querying Agent B (Gemini 2.0 Flash)..." });
        if (demoMode) await wait(400);
        send("step", { message: "Querying Agent C (Claude claude-sonnet-4)..." });

        let individualResponses;
        if (demoMode) {
          await wait(2500);
          individualResponses = getDemoResponses();
          console.log("[Demo] Using hardcoded LLM responses");

          send("step", {
            message: `Agent B responded (${individualResponses.gemini.content.length} chars)`,
          });
          await wait(1500);
          send("step", {
            message: `Agent A responded (${individualResponses.openai.content.length} chars)`,
          });
          await wait(2800);
          send("step", {
            message: `Agent C responded (${individualResponses.claude.content.length} chars)`,
          });
        } else {
          individualResponses = await inputOrchestrator(query);

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
          send("step", {
            message: individualResponses.claude.error
              ? `Agent C failed: ${individualResponses.claude.error}`
              : `Agent C responded (${individualResponses.claude.content.length} chars)`,
          });
        }

        // Step 3: Verify  (~22s total in demo)
        if (demoMode) await wait(1000);
        send("step", { message: "Sending responses to VeriScore VM for claim extraction (this may take a few minutes)..." });

        let verification;
        if (demoMode) {
          await wait(4000);
          send("step", { message: "Extracting claims from Agent A response..." });
          await wait(3500);
          send("step", { message: "Extracting claims from Agent B response..." });
          await wait(3500);
          send("step", { message: "Extracting claims from Agent C response..." });
          await wait(3000);

          send("step", { message: "Running cross-LLM classifier analysis..." });
          await wait(5000);

          verification = getDemoVerification();
          console.log("[Demo] Using hardcoded verification results from result_new.json");
        } else {
          verification = await runVerification(
            query,
            individualResponses.openai.content || "",
            individualResponses.gemini.content || "",
            individualResponses.claude.content || "",
            () => send("step", { message: "Running cross-LLM classifier analysis..." })
          );
        }

        const totalClaims = verification.claims.allClaims.length;
        if (demoMode) await wait(800);
        send("step", {
          message: `VeriScore complete: ${totalClaims} claims verified across all agents`,
        });
        if (demoMode) await wait(1000);
        send("step", {
          message: `Precision — Agent A: ${Math.round(verification.scores.agentA.precision * 100)}% | Agent B: ${Math.round(verification.scores.agentB.precision * 100)}% | Agent C: ${Math.round(verification.scores.agentC.precision * 100)}%`,
        });

        if (demoMode) await wait(600);
        const winner = verification.claims.winner;
        send("step", {
          message: `Winner: Agent ${winner} (${AGENT_NAMES[winner]})`,
        });

        // Step 4: Reward
        if (demoMode) await wait(800);
        send("step", { message: `Distributing rewards to Agent ${winner}...` });

        let reward = null;
        try {
          reward = await distributeRewards(winner);
          send("step", {
            message: reward.winnerTx.success
              ? `Agent ${winner} rewarded ${reward.winnerAmount} KITE (tx: ${reward.winnerTx.transactionHash?.slice(0, 10)}...)`
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
          transactions: { escrowA: escrowAResult, escrowB: escrowBResult, escrowC: escrowCResult, reward },
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
