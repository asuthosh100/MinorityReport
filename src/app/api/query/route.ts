import { NextRequest } from "next/server";
import { inputOrchestrator } from "@/lib/orchestrator/input";
import { stakeFromAgent, distributeRewards } from "@/lib/kite/transactions";
import { runVerification } from "@/lib/verifier/claude";
import { STAKE_AMOUNT } from "@/lib/kite/config";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { query } = body;

  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ error: "A query string is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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
        // Step 1: Stake
        send("step", { message: `Agent A staking ${STAKE_AMOUNT} KITE...` });
        send("step", { message: `Agent B staking ${STAKE_AMOUNT} KITE...` });

        const [stakeA, stakeB] = await Promise.allSettled([
          stakeFromAgent("A"),
          stakeFromAgent("B"),
        ]);

        const stakeAResult = stakeA.status === "fulfilled" ? stakeA.value : { success: false, error: String(stakeA.reason) };
        const stakeBResult = stakeB.status === "fulfilled" ? stakeB.value : { success: false, error: String(stakeB.reason) };

        send("step", {
          message: stakeAResult.success
            ? `Agent A staked ${STAKE_AMOUNT} KITE (tx: ${stakeAResult.transactionHash?.slice(0, 10)}...)`
            : `Agent A stake failed: ${stakeAResult.error}`,
        });
        send("step", {
          message: stakeBResult.success
            ? `Agent B staked ${STAKE_AMOUNT} KITE (tx: ${stakeBResult.transactionHash?.slice(0, 10)}...)`
            : `Agent B stake failed: ${stakeBResult.error}`,
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
          transactions: { stakeA: stakeAResult, stakeB: stakeBResult, reward },
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
