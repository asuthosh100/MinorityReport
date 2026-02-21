import { queryOpenAI } from "@/lib/models/openai";
import { queryGemini } from "@/lib/models/gemini";
import { queryClaude } from "@/lib/models/claude";

export interface ModelResponse {
  model: string;
  content: string;
  error?: string;
}

export interface InputOrchestratorResult {
  openai: ModelResponse;
  gemini: ModelResponse;
  claude: ModelResponse;
}

export async function inputOrchestrator(
  query: string
): Promise<InputOrchestratorResult> {
  const [openaiResult, geminiResult, claudeResult] = await Promise.allSettled([
    queryOpenAI(query),
    queryGemini(query),
    queryClaude(query),
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
    claude: {
      model: "claude-sonnet-4",
      content:
        claudeResult.status === "fulfilled" ? claudeResult.value : "",
      error:
        claudeResult.status === "rejected"
          ? String(claudeResult.reason)
          : undefined,
    },
  };
}
