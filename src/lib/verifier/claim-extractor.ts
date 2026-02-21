import crypto from "crypto";

const VERISCORE_URL = process.env.VERISCORE_URL || "http://localhost:8000";
const VERISCORE_JWT_SECRET =
  process.env.VERISCORE_JWT_SECRET ||
  "sJtuUxk54BR2bIZhs89Iw3hpJuICIYajRQv_PWMhnLung88tBGW4CdfPzWJmEfpW";

export interface VeriScoreClaimResult {
  claim: string;
  verificationResult: string;
}

export interface VeriScoreAgentResult {
  claims: VeriScoreClaimResult[];
  supportedCount: number;
  totalClaims: number;
  precision: number;
}

export interface VeriScoreResults {
  agentA: VeriScoreAgentResult;
  agentB: VeriScoreAgentResult;
  agentC: VeriScoreAgentResult;
}

function createJWT(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      sub: "openclaw",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", VERISCORE_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

const EMPTY_RESULT: VeriScoreAgentResult = {
  claims: [],
  supportedCount: 0,
  totalClaims: 0,
  precision: 0,
};

async function callVeriScore(
  question: string,
  response: string,
  model: string
): Promise<VeriScoreAgentResult> {
  const token = createJWT();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    console.log(`[VeriScore] Calling VM for model=${model}...`);
    const res = await fetch(`${VERISCORE_URL}/veriscore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, response, model, prompt_source: "default" }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[VeriScore] Error for model=${model}: ${res.status} ${detail}`);
      return EMPTY_RESULT;
    }

    const data = await res.json();
    console.log(
      `[VeriScore] model=${model} → ${data.total_claims ?? 0} claims, ` +
      `${data.supported_count ?? 0} supported, precision=${data.precision ?? 0}`
    );

    const claims: VeriScoreClaimResult[] = (data.claim_verification_result ?? []).map(
      (c: { claim: string; verification_result: string }) => ({
        claim: c.claim,
        verificationResult: c.verification_result,
      })
    );

    return {
      claims,
      supportedCount: data.supported_count ?? 0,
      totalClaims: data.total_claims ?? 0,
      precision: data.precision ?? 0,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error(`[VeriScore] Timeout for model=${model} (600s exceeded)`);
    } else {
      console.error(`[VeriScore] Fetch error for model=${model}:`, err);
    }
    return EMPTY_RESULT;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runVeriScore(
  query: string,
  agentAResponse: string,
  agentBResponse: string,
  agentCResponse: string
): Promise<VeriScoreResults> {
  console.log(`[VeriScore] Starting verification for all 3 agents...`);

  const [agentA, agentB, agentC] = await Promise.all([
    callVeriScore(query, agentAResponse, "gpt"),
    callVeriScore(query, agentBResponse, "gemini"),
    callVeriScore(query, agentCResponse, "claude"),
  ]);

  console.log(
    `[VeriScore] Done — A: ${agentA.totalClaims} claims (${(agentA.precision * 100).toFixed(1)}%) | ` +
    `B: ${agentB.totalClaims} claims (${(agentB.precision * 100).toFixed(1)}%) | ` +
    `C: ${agentC.totalClaims} claims (${(agentC.precision * 100).toFixed(1)}%)`
  );

  return { agentA, agentB, agentC };
}
