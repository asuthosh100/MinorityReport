import Anthropic from "@anthropic-ai/sdk";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export interface ExtractedClaims {
  agentAClaims: { claim: string; originalText: string }[];
  agentBClaims: { claim: string; originalText: string }[];
}

const EXTRACTION_PROMPT = `You are a claim extraction assistant. Extract ONLY verifiable atomic claims from the given AI response.

Rules:
- Each claim must describe a single verifiable fact (an event, state, or measurable assertion)
- Each claim must be self-contained — replace all pronouns with named entities
- SKIP: opinions, hypotheticals, advice, instructions, subjective statements, stories
- Preserve temporal/spatial qualifiers
- Include the exact sentence or phrase from the original text that contains this claim as "originalText"

Respond with a JSON array. Each element: { "claim": "<atomic claim>", "originalText": "<exact source text>" }
If there are no verifiable claims, respond with an empty array: []`;

async function extractClaimsFromResponse(
  response: string
): Promise<{ claim: string; originalText: string }[]> {
  const message = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nAI Response:\n${response}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse JSON from the response, handling potential markdown code blocks
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

export async function extractClaims(
  agentAResponse: string,
  agentBResponse: string
): Promise<ExtractedClaims> {
  const [agentAClaims, agentBClaims] = await Promise.all([
    extractClaimsFromResponse(agentAResponse),
    extractClaimsFromResponse(agentBResponse),
  ]);

  return { agentAClaims, agentBClaims };
}
