import { runVerification, type VerificationResult } from "@/lib/verifier/claude";
import { stakeFromAgent, distributeRewards, type TransactionResult } from "@/lib/kite/transactions";
import type { InputOrchestratorResult } from "./input";

export interface TransactionInfo {
  stakeA: TransactionResult;
  stakeB: TransactionResult;
  reward: {
    winnerTx: TransactionResult;
    verifierCut: string;
    winnerAmount: string;
  } | null;
}

export interface OutputOrchestratorResult {
  verification: VerificationResult;
  transactions: TransactionInfo;
  individualResponses: InputOrchestratorResult;
}

export async function outputOrchestrator(
  query: string,
  responses: InputOrchestratorResult
): Promise<OutputOrchestratorResult> {
  // Step 1: Stake from both agents in parallel
  const [stakeA, stakeB] = await Promise.allSettled([
    stakeFromAgent("A"),
    stakeFromAgent("B"),
  ]);

  const stakeAResult: TransactionResult =
    stakeA.status === "fulfilled"
      ? stakeA.value
      : { success: false, error: String(stakeA.reason) };
  const stakeBResult: TransactionResult =
    stakeB.status === "fulfilled"
      ? stakeB.value
      : { success: false, error: String(stakeB.reason) };

  // Step 2: Run VeriScore verification pipeline
  const verification = await runVerification(
    query,
    responses.openai.content || "",
    responses.gemini.content || ""
  );

  // Step 3: Distribute rewards to winner
  let reward: TransactionInfo["reward"] = null;
  try {
    reward = await distributeRewards(verification.claims.winner);
  } catch (error) {
    reward = {
      winnerTx: { success: false, error: String(error) },
      verifierCut: "0",
      winnerAmount: "0",
    };
  }

  return {
    verification,
    transactions: {
      stakeA: stakeAResult,
      stakeB: stakeBResult,
      reward,
    },
    individualResponses: responses,
  };
}
