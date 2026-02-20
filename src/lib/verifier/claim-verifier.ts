import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedClaims } from "./claim-extractor";

function getClient() {
  return new Anthropic({ apiKey: process.env.MY_ANTHROPIC_API_KEY });
}

export interface ClaimClassification {
  claim: string;
  originalText: string;
  source: "A" | "B";
  status: "supported" | "contradicted" | "inconclusive" | "novel";
}

export interface CrossAgentResult {
  allClaims: ClaimClassification[];
  consensusInsights: string[];
  novelInsights: { agent: "A" | "B"; insight: string }[];
  bestNovelInsight: {
    agent: "A" | "B";
    insight: string;
    reasoning: string;
  };
  winner: "A" | "B";
}

const VERIFICATION_PROMPT = `You are a claim verification and comparison assistant. You will receive claims extracted from two AI agents' responses to the same query.

Your job is to do a UNIFIED cross-comparison of ALL claims from both agents together:

1. For each claim, determine its status by comparing it against the OTHER agent's claims:
   - "supported" — the other agent makes a substantially similar claim
   - "contradicted" — the other agent directly disputes or says the opposite
   - "inconclusive" — partial overlap, ambiguous, or can't determine from the other agent's claims
   - "novel" — this claim is unique to this agent and the other agent says nothing about it

2. Identify consensus (majority) insights — topics/facts both agents agree on
3. Identify novel (minority) insights — unique valuable claims made by only one agent
4. Judge which agent produced the BEST novel insight and declare a winner

Respond with JSON in this exact format:
{
  "classifiedClaims": [
    { "claim": "...", "originalText": "...", "source": "A" | "B", "status": "supported" | "contradicted" | "inconclusive" | "novel" }
  ],
  "consensusInsights": ["insight both agents agree on", ...],
  "novelInsights": [{ "agent": "A" | "B", "insight": "..." }, ...],
  "bestNovelInsight": { "agent": "A" | "B", "insight": "...", "reasoning": "why this is the best novel insight" },
  "winner": "A" | "B"
}`;

export async function verifyClaims(
  query: string,
  extractedClaims: ExtractedClaims
): Promise<CrossAgentResult> {
  const agentAClaimsList = extractedClaims.agentAClaims
    .map((c, i) => `  ${i + 1}. Claim: "${c.claim}" | Original: "${c.originalText}"`)
    .join("\n");

  const agentBClaimsList = extractedClaims.agentBClaims
    .map((c, i) => `  ${i + 1}. Claim: "${c.claim}" | Original: "${c.originalText}"`)
    .join("\n");

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${VERIFICATION_PROMPT}

Original user query: "${query}"

Agent A (OpenAI) claims:
${agentAClaimsList || "  (no verifiable claims)"}

Agent B (Gemini) claims:
${agentBClaimsList || "  (no verifiable claims)"}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      allClaims: [],
      consensusInsights: [],
      novelInsights: [],
      bestNovelInsight: { agent: "A", insight: "N/A", reasoning: "No claims to compare" },
      winner: "A",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      allClaims: parsed.classifiedClaims || [],
      consensusInsights: parsed.consensusInsights || [],
      novelInsights: parsed.novelInsights || [],
      bestNovelInsight: parsed.bestNovelInsight || {
        agent: "A",
        insight: "N/A",
        reasoning: "N/A",
      },
      winner: parsed.winner || "A",
    };
  } catch {
    return {
      allClaims: [],
      consensusInsights: [],
      novelInsights: [],
      bestNovelInsight: { agent: "A", insight: "N/A", reasoning: "Parse error" },
      winner: "A",
    };
  }
}
