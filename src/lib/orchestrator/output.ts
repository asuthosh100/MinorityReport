import { queryOpenAI } from "@/lib/models/openai";
import type { InputOrchestratorResult } from "./input";

export interface OutputOrchestratorResult {
  synthesis: string;
  individualResponses: InputOrchestratorResult;
}

export async function outputOrchestrator(
  query: string,
  responses: InputOrchestratorResult
): Promise<OutputOrchestratorResult> {
  const parts: string[] = [];

  if (responses.openai.content) {
    parts.push(`**OpenAI (${responses.openai.model}):**\n${responses.openai.content}`);
  }
  if (responses.gemini.content) {
    parts.push(`**Gemini (${responses.gemini.model}):**\n${responses.gemini.content}`);
  }

  if (parts.length === 0) {
    return {
      synthesis: "Both models failed to respond. Please try again.",
      individualResponses: responses,
    };
  }

  if (parts.length === 1) {
    return {
      synthesis: parts[0],
      individualResponses: responses,
    };
  }

  const metaPrompt = `You are a synthesis assistant. A user asked the following question:

"${query}"

Two AI models provided these responses:

${parts.join("\n\n")}

Synthesize the best possible answer by combining the strengths of both responses. Be concise and accurate. If the responses conflict, note the disagreement and provide the most well-supported answer.`;

  const synthesis = await queryOpenAI(metaPrompt);

  return {
    synthesis,
    individualResponses: responses,
  };
}
