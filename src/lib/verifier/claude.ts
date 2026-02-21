import { runVeriScore, type VeriScoreAgentResult } from "./claim-extractor";
import type { AgentId } from "@/lib/types";

export interface ClaimClassification {
  claim: string;
  source: AgentId;
  status: "supported" | "inconclusive";
}

export interface AgentScore {
  total: number;
  supported: number;
  inconclusive: number;
  precision: number;
}

export interface VerificationResult {
  claims: {
    allClaims: ClaimClassification[];
    winner: AgentId;
  };
  scores: {
    agentA: AgentScore;
    agentB: AgentScore;
    agentC: AgentScore;
  };
}

function buildClaims(
  result: VeriScoreAgentResult,
  source: AgentId
): ClaimClassification[] {
  return result.claims.map((c) => ({
    claim: c.claim,
    source,
    status:
      c.verificationResult === "supported"
        ? ("supported" as const)
        : ("inconclusive" as const),
  }));
}

function buildScore(result: VeriScoreAgentResult): AgentScore {
  return {
    total: result.totalClaims,
    supported: result.supportedCount,
    inconclusive: result.totalClaims - result.supportedCount,
    precision: Math.round(result.precision * 1000) / 1000,
  };
}

export async function runVerification(
  query: string,
  agentAResponse: string,
  agentBResponse: string,
  agentCResponse: string
): Promise<VerificationResult> {
  const vs = await runVeriScore(query, agentAResponse, agentBResponse, agentCResponse);

  const allClaims: ClaimClassification[] = [
    ...buildClaims(vs.agentA, "A"),
    ...buildClaims(vs.agentB, "B"),
    ...buildClaims(vs.agentC, "C"),
  ];

  const scores = {
    agentA: buildScore(vs.agentA),
    agentB: buildScore(vs.agentB),
    agentC: buildScore(vs.agentC),
  };

  // Winner = highest precision, ties broken by more supported claims
  const agents: { id: AgentId; precision: number; supported: number }[] = [
    { id: "A", precision: vs.agentA.precision, supported: vs.agentA.supportedCount },
    { id: "B", precision: vs.agentB.precision, supported: vs.agentB.supportedCount },
    { id: "C", precision: vs.agentC.precision, supported: vs.agentC.supportedCount },
  ];
  agents.sort((a, b) => b.precision - a.precision || b.supported - a.supported);

  return {
    claims: { allClaims, winner: agents[0].id },
    scores,
  };
}
