/**
 * Wizard-of-Oz demo mode.
 * When DEMO_MODE=true (or the query fuzzy-matches the demo question),
 * hardcoded responses and verification results are returned instead of
 * calling external LLM / VeriScore / Classifier APIs.
 */

import resultData from "./demo-result.json";
import type { InputOrchestratorResult } from "./orchestrator/input";
import type { VerificationResult } from "./verifier/claude";
import type { ClaimClassification, AgentScore } from "./verifier/claude";
import type { ClassifierResult } from "./verifier/classifier";
import type { AgentId } from "./types";

// ── Demo question (fuzzy matched) ──────────────────────────────────────
const DEMO_QUESTION =
  "What is the effect of reduced US exposure on companies importing from india and was the USD exposure reduced because of EU-india bi-lateral trade deal";

// ── Hardcoded LLM responses from response.md ──────────────────────────
const CLAUDE_RESPONSE = `The imposition of 50 percent tariffs by the United States on Indian goods starting in August 2025 fundamentally reshaped the dynamics of companies importing from India, creating cascading disruptions across global supply chains and accelerating a strategic recalibration of trade partnerships that extends far beyond conventional commercial considerations. The tariffs, combining a 10% baseline duty, a 25% reciprocal tariff announced in April 2025, and an additional 25% tariff effective August 27, 2025, placed India among the highest-tariffed US trading partners, directly threatening approximately $87 billion in Indian exports to the US, equivalent to 2.5% of India's GDP. Companies importing from India faced a fundamental business model collapse, particularly in labor-intensive sectors; Indian garment exporters typically operating on margins of 8-15% found the 50% tariff impossible to absorb, forcing them to either pass costs to American buyers who would source elsewhere or bear losses themselves, and Indian exports to the United States fell 28.5% between May and October 2025. This forced importers to undertake urgent supply chain restructuring, with firms exploring sourcing from Vietnam, Bangladesh, Indonesia, and other lower-tariff jurisdictions where competitors faced rates of 20 percent or less. The underlying cause of these US tariffs was geopolitical rather than purely commercial; Washington imposed the tariffs in response to India's continued purchases of Russian oil and stalled trade negotiations, with the Trump administration using economic measures to pressure India's strategic autonomy. The USD exposure reduction for companies importing from India was indeed directly connected to the EU-India bilateral trade deal, though the causality is more nuanced than simple cause-and-effect. The EU-India FTA's conclusion on January 27, 2026, was driven in large part by shifting geopolitical pressures from Washington and Beijing, which forced both Brussels and New Delhi to reassess their strategic positioning, with Washington's resort to economic pressures reinforcing this reassessment. Rather than the EU deal reducing US exposure directly, the brutal reality of the 50 percent tariffs accelerated companies' desperate search for alternative markets, making the EU-India FTA a strategically timed opportunity rather than a cause of diversification. The EU-India FTA, described as the "mother of all deals," aims to liberalize trade and investment between the two economies and creates a free trade zone of 2 billion people, with the free trade agreement seeing India reduce tariffs on over 90% of European exports while the EU does the same for Indian textiles, leather, marine products and gems and jewelry, many of which have been affected by the US imposing 50% tariffs. Companies importing from India subsequently seized upon this opportunity to redirect shipments; the India-UK free trade agreement signed in July 2025 grants zero-duty access on 99% of Indian exports, and industry bodies report that exports to 24 countries including Germany, the UAE, and Brazil grew in the latter half of 2025 even as American-bound shipments collapsed. The USD exposure reduction was therefore a symptom of necessity rather than a deliberate policy outcome of the EU deal—companies needed alternatives to the American market and the EU agreement provided timing and mechanism, but the driving force was the sheer uncompetitiveness of US-sourced Indian goods under 50 percent tariffs. Recently, on February 2, 2026, President Donald Trump announced that the United States had reached an agreement with India to roll back tariffs on Indian imports from 50% to 18%, with India agreeing to eliminate tariffs and non-tariff barriers on US goods and committing to stop purchasing Russian oil and increase imports of US energy, technology, agricultural, coal, and other products. This resolution suggests that the extreme tariff regime may have been more tactical geopolitical posturing than permanent trade policy, even as companies continue their pivot toward diversified sourcing from multiple regions including Europe, which now benefits from the preferential tariff treatment granted under the newly concluded EU-India agreement.`;

const GPT_RESPONSE = `Reduced U.S. exposure—meaning a company is less dependent on U.S. demand, U.S. trade policy (tariffs/sanctions/export controls), U.S. shipping lanes and compliance rules, and/or U.S.-dollar (USD) settlement—generally makes importers sourcing from India less sensitive to U.S.-specific shocks. For companies importing from India, that usually shows up as (1) lower concentration risk (fewer "single-market" disruptions if U.S. demand weakens or U.S. policy tightens), (2) more pricing stability if contracts can be diversified across currencies and customers rather than being anchored to USD pricing cycles, and (3) potentially lower FX and financing costs over time if they can reduce the amount of receivables/payables that must be hedged in USD (though hedging doesn't disappear—it often shifts to EUR/INR or a basket). In practice, firms reduce currency exposure through a mix of contract currency choice (invoicing) and hedging tools like forwards/options/swaps, plus "natural hedges" (matching costs and revenues in the same currency).On your second question: the EU–India trade deal can contribute to reduced USD exposure, but it's not automatically the reason USD exposure fell—because a trade agreement mainly changes tariffs and market access, while USD exposure is driven by how trade is invoiced/financed and how firms manage risk. That said, the newly concluded EU–India Free Trade Agreement was explicitly framed as a way to expand EU–India trade and "reduce dependence" on U.S. markets, which can indirectly encourage more EU–India commerce to be priced/settled in EUR (or INR/EUR structures) rather than USD. The clean way to think about it is: the deal can shift trade flows, and shifting flows can shift currency mix, but the currency exposure only truly reduces if companies renegotiate terms (e.g., invoice in EUR/INR, shorten payment cycles, add FX adjustment clauses) and/or change their hedging approach.`;

const GEMINI_RESPONSE = `The reduction in U.S. dollar (USD) exposure for companies importing from India is primarily a strategic reaction to the heightened volatility and trade costs associated with the aggressive "reciprocal tariff" regime enacted by the Trump administration throughout 2025, rather than a direct outcome of the EU-India bilateral trade deal. Between August 2025 and early 2026, U.S. importers faced effective tariffs as high as 50% on various Indian goods—including textiles, leather, and jewelry—forcing a frantic reassessment of dollar-denominated contracts and supply chain dependencies. While a landmark "interim" trade deal reached in February 2026 has successfully lowered these reciprocal tariffs to 18%, the preceding months of "tariff deadlock" significantly eroded the USD's reliability as a stable trade vehicle for Indo-US commerce. This instability incentivized many U.S. and Indian firms to explore local currency settlement mechanisms and alternative payment systems to bypass the inflationary pressures of a fluctuating rupee-dollar exchange rate, which hit record lows of over 90 INR per USD in early 2026. Contrary to the idea that the EU-India Free Trade Agreement (FTA) caused this shift, the FTA—often dubbed the "mother of all deals"—actually served as a timely "diversification hedge" for Indian exporters looking to escape the unpredictable U.S. market. By eliminating duties on over 90% of Indian goods, the EU-India deal made the Euro and the Rupee more attractive for bilateral settlement, specifically in the financial services annex finalized in January 2026, which aims to improve payment system interoperability and real-time remittances. Consequently, while the EU-India deal didn't cause the reduction in USD exposure in U.S. trade, it provided the necessary infrastructure for India to pivot its trade volume away from the dollar-centric U.S. corridor, effectively accelerating a "de-dollarization" trend driven by American protectionism.`;

// ── Helpers ─────────────────────────────────────────────────────────────

/** Normalize text for fuzzy comparison */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Check if a query is "close enough" to the demo question */
export function isDemoQuery(query: string): boolean {
  if (process.env.DEMO_MODE === "true") return true;
  const nq = normalize(query);
  const nd = normalize(DEMO_QUESTION);
  // Check if query contains key phrases
  const keyPhrases = ["reduced us exposure", "importing from india", "eu-india", "bilateral trade deal", "usd exposure"];
  const matchCount = keyPhrases.filter((p) => normalize(query).includes(normalize(p))).length;
  return matchCount >= 3 || nq === nd;
}

// ── Hardcoded input orchestrator result ─────────────────────────────────
export function getDemoResponses(): InputOrchestratorResult {
  return {
    openai: { model: "gpt-4o-mini", content: GPT_RESPONSE },
    gemini: { model: "gemini-2.0-flash", content: GEMINI_RESPONSE },
    claude: { model: "claude-sonnet-4", content: CLAUDE_RESPONSE },
  };
}

// ── Hardcoded verification result from result_new.json ──────────────────

function buildDemoClaimsForAgent(
  modelKey: "claude" | "gpt-4" | "gemini",
  source: AgentId
): ClaimClassification[] {
  const claims: ClaimClassification[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = resultData as any;

  for (const category of ["minority_claims", "majority_claims"]) {
    const modelData = data[category]?.[modelKey];
    if (!modelData) continue;

    for (const claim of modelData.supported ?? []) {
      claims.push({ claim: String(claim[0]), source, status: "supported" });
    }
    for (const claim of modelData.inconclusive ?? []) {
      claims.push({ claim: String(claim[0]), source, status: "inconclusive" });
    }
    // contradicted → inconclusive for the UI
    for (const claim of modelData.contradicted ?? []) {
      claims.push({ claim: String(claim[0]), source, status: "inconclusive" });
    }
  }
  return claims;
}

export function getDemoVerification(): VerificationResult {
  // Scores extracted from result_new.json quick_notes.precision_ranking
  const scores: Record<string, AgentScore> = {
    agentA: { total: 28, supported: 7, inconclusive: 21, precision: 0.250 },
    agentB: { total: 32, supported: 11, inconclusive: 21, precision: 0.344 },
    agentC: { total: 65, supported: 38, inconclusive: 27, precision: 0.585 },
  };

  const allClaims: ClaimClassification[] = [
    ...buildDemoClaimsForAgent("gpt-4", "A"),
    ...buildDemoClaimsForAgent("gemini", "B"),
    ...buildDemoClaimsForAgent("claude", "C"),
  ];

  // Build classifier result directly from result_new.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = resultData as any;
  const classifierResult: ClassifierResult = {
    minorityClaims: raw.minority_claims as ClassifierResult["minorityClaims"],
    majorityClaims: raw.majority_claims as ClassifierResult["majorityClaims"],
    responses: raw.responses as Record<string, string>,
    quickNotes: raw.quick_notes as ClassifierResult["quickNotes"],
  };

  return {
    claims: { allClaims, winner: "C" as AgentId },
    scores: {
      agentA: scores.agentA,
      agentB: scores.agentB,
      agentC: scores.agentC,
    },
    classifierResult,
  };
}
