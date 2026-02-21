import crypto from "crypto";
import type { VeriScoreResults } from "./claim-extractor";

const CLASSIFIER_URL = process.env.CLASSIFIER_URL || "http://localhost:8001";
const CLASSIFIER_JWT_SECRET =
  process.env.CLASSIFIER_JWT_SECRET || "veriscore-ethdenver-2026-secret-key";

export interface ClassifierQuickNotes {
  overall_summary: string;
  precision_ranking: Record<string, string>;
  claim_volume: Record<string, string>;
  majority_fact_observations: string[];
  minority_fact_observations: string[];
  red_flags: string[];
  majority_clusters: { theme: string; members: { llm: string; idx: number }[] }[];
}

export interface ClassifierResult {
  minorityClaims: Record<string, { supported: string[][]; inconclusive: string[][]; contradicted: string[][] }>;
  majorityClaims: Record<string, { supported: string[][]; inconclusive: string[][]; contradicted: string[][] }>;
  responses: Record<string, string>;
  quickNotes: ClassifierQuickNotes;
}

function createJWT(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      sub: "veriscore-client",
      iss: "veriscore-api",
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", CLASSIFIER_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

function buildAnalyzePayload(
  query: string,
  agentResponses: { openai: string; gemini: string; claude: string },
  vs: VeriScoreResults
) {
  const agents = [
    { key: "agentA" as const, model: "gpt", response: agentResponses.openai },
    { key: "agentB" as const, model: "gemini", response: agentResponses.gemini },
    { key: "agentC" as const, model: "claude", response: agentResponses.claude },
  ];

  const files = agents.map(({ key, model, response }) => {
    const agentResult = vs[key];
    return {
      question: query,
      response,
      model,
      claim_verification_result: agentResult.claims.map((c) => ({
        claim: c.claim,
        verification_result: c.verificationResult,
      })),
      supported_count: agentResult.supportedCount,
      total_claims: agentResult.totalClaims,
      precision: agentResult.precision,
    };
  });

  return { files, local_only: false };
}

export async function callClassifier(
  query: string,
  agentResponses: { openai: string; gemini: string; claude: string },
  vs: VeriScoreResults
): Promise<ClassifierResult | null> {
  const token = createJWT();
  const body = buildAnalyzePayload(query, agentResponses, vs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    console.log("[Classifier] Calling classifier API...");
    const res = await fetch(`${CLASSIFIER_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[Classifier] Error: ${res.status} ${detail}`);
      return null;
    }

    const data = await res.json();
    console.log("[Classifier] Success — got annotated responses and quick notes");

    return {
      minorityClaims: data.minority_claims ?? {},
      majorityClaims: data.majority_claims ?? {},
      responses: data.responses ?? {},
      quickNotes: {
        overall_summary: data.quick_notes?.overall_summary ?? "",
        precision_ranking: data.quick_notes?.precision_ranking ?? {},
        claim_volume: data.quick_notes?.claim_volume ?? {},
        majority_fact_observations: data.quick_notes?.majority_fact_observations ?? [],
        minority_fact_observations: data.quick_notes?.minority_fact_observations ?? [],
        red_flags: data.quick_notes?.red_flags ?? [],
        majority_clusters: data.quick_notes?.majority_clusters ?? [],
      },
    };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error("[Classifier] Timeout (600s exceeded)");
    } else {
      console.error("[Classifier] Fetch error:", err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
