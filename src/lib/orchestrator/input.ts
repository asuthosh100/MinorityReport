import { queryOpenAI } from "@/lib/models/openai";
import { queryGemini } from "@/lib/models/gemini";

export interface ModelResponse {
  model: string;
  content: string;
  error?: string;
}

export interface InputOrchestratorResult {
  openai: ModelResponse;
  gemini: ModelResponse;
}

export async function inputOrchestrator(
  query: string
): Promise<InputOrchestratorResult> {
  const [openaiResult, geminiResult] = await Promise.allSettled([
    queryOpenAI(query),
    queryGemini(query),
  ]);

  return {
    openai: {
      model: "gpt-4o-mini",
      content:
        openaiResult.status === "fulfilled" ? openaiResult.value : "",
      error:
        openaiResult.status === "rejected"
          ? String(openaiResult.reason)
          : undefined,
    },
    gemini: {
      model: "gemini-2.0-flash",
      content:
        geminiResult.status === "fulfilled" ? geminiResult.value : "",
      error:
        geminiResult.status === "rejected"
          ? String(geminiResult.reason)
          : undefined,
    },
  };
}
