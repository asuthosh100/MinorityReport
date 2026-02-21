import { extractClaims } from "./claim-extractor";
import { verifyClaims, type CrossAgentResult } from "./claim-verifier";
import { computeScores, type ScoreResult } from "./scorer";

export interface VerificationResult {
  claims: CrossAgentResult;
  scores: ScoreResult;
}

export async function runVerification(
  query: string,
  agentAResponse: string,
  agentBResponse: string,
  agentCResponse: string
): Promise<VerificationResult> {
  // Stage 1: Extract verifiable atomic claims from all three responses
  const extractedClaims = await extractClaims(agentAResponse, agentBResponse, agentCResponse);

  // Stage 2: Cross-agent verification — unified comparison
  const claims = await verifyClaims(query, extractedClaims);

  // Stage 3: Compute VeriScore (F1@K) per agent
  const scores = computeScores(claims.allClaims);

  return { claims, scores };
}
