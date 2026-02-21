export type AgentId = "A" | "B" | "C";

export const AGENT_NAMES: Record<AgentId, string> = {
  A: "OpenAI",
  B: "Gemini",
  C: "Claude",
};

export const ALL_AGENTS: readonly AgentId[] = ["A", "B", "C"] as const;
