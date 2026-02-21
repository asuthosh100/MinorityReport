import { runVerification, type VerificationResult } from "@/lib/verifier/claude";
import { escrowFromAgent, distributeRewards, type TransactionResult } from "@/lib/kite/transactions";
import type { InputOrchestratorResult } from "./input";

export interface TransactionInfo {
  escrowA: TransactionResult;
  escrowB: TransactionResult;
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
  // Step 1: Escrow from both agents in parallel
  const [escrowA, escrowB] = await Promise.allSettled([
    escrowFromAgent("A"),
    escrowFromAgent("B"),
  ]);

  const escrowAResult: TransactionResult =
    escrowA.status === "fulfilled"
      ? escrowA.value
      : { success: false, error: String(escrowA.reason) };
  const escrowBResult: TransactionResult =
    escrowB.status === "fulfilled"
      ? escrowB.value
      : { success: false, error: String(escrowB.reason) };

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
      escrowA: escrowAResult,
      escrowB: escrowBResult,
      reward,
    },
    individualResponses: responses,
  };
}
