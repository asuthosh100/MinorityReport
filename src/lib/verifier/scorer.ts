import type { ClaimClassification } from "./claim-verifier";

export interface AgentScore {
  total: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  novel: number;
  precision: number;
  recallAtK: number;
  veriScore: number;
}

export interface ScoreResult {
  K: number;
  agentA: AgentScore;
  agentB: AgentScore;
}

function computeAgentScore(
  claims: ClaimClassification[],
  K: number
): AgentScore {
  const total = claims.length;
  const supported = claims.filter((c) => c.status === "supported").length;
  const contradicted = claims.filter((c) => c.status === "contradicted").length;
  const inconclusive = claims.filter((c) => c.status === "inconclusive").length;
  const novel = claims.filter((c) => c.status === "novel").length;

  const precision = total > 0 ? supported / total : 0;
  const recallAtK = K > 0 ? Math.min(supported / K, 1) : 0;
  const veriScore =
    precision + recallAtK > 0
      ? (2 * precision * recallAtK) / (precision + recallAtK)
      : 0;

  return {
    total,
    supported,
    contradicted,
    inconclusive,
    novel,
    precision: Math.round(precision * 1000) / 1000,
    recallAtK: Math.round(recallAtK * 1000) / 1000,
    veriScore: Math.round(veriScore * 1000) / 1000,
  };
}

export function computeScores(
  allClaims: ClaimClassification[]
): ScoreResult {
  const agentAClaims = allClaims.filter((c) => c.source === "A");
  const agentBClaims = allClaims.filter((c) => c.source === "B");

  // K = median of both agents' total claims
  const totals = [agentAClaims.length, agentBClaims.length].sort(
    (a, b) => a - b
  );
  const K =
    totals.length % 2 === 0
      ? (totals[0] + totals[1]) / 2
      : totals[Math.floor(totals.length / 2)];

  return {
    K,
    agentA: computeAgentScore(agentAClaims, K),
    agentB: computeAgentScore(agentBClaims, K),
  };
}
