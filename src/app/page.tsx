"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

type AgentId = "A" | "B" | "C";

const AGENT_NAMES: Record<AgentId, string> = {
  A: "OpenAI",
  B: "Gemini",
  C: "Claude",
};

interface ClaimClassification {
  claim: string;
  source: AgentId;
  status: "supported" | "inconclusive";
}

interface AgentScore {
  total: number;
  supported: number;
  inconclusive: number;
  precision: number;
}

interface WalletInfo {
  agent: string;
  eoa: string;
  aaWallet: string;
  balance: { kite: string; usdt: string };
}

interface ClassifierQuickNotes {
  overall_summary: string;
  precision_ranking: Record<string, string>;
  claim_volume: Record<string, string>;
  majority_fact_observations: string[];
  minority_fact_observations: string[];
  red_flags: string[];
  majority_clusters: { theme: string; members: { llm: string; idx: number }[] }[];
}

interface ClassifierResult {
  minorityClaims: Record<string, { supported: string[][]; inconclusive: string[][]; contradicted: string[][] }>;
  majorityClaims: Record<string, { supported: string[][]; inconclusive: string[][]; contradicted: string[][] }>;
  responses: Record<string, string>;
  quickNotes: ClassifierQuickNotes;
}

interface QueryResult {
  verification: {
    claims: {
      allClaims: ClaimClassification[];
      winner: AgentId;
    };
    scores: {
      agentA: AgentScore;
      agentB: AgentScore;
      agentC: AgentScore;
    };
    classifierResult?: ClassifierResult | null;
  };
  transactions: {
    escrowA: { success: boolean; transactionHash?: string; error?: string };
    escrowB: { success: boolean; transactionHash?: string; error?: string };
    escrowC: { success: boolean; transactionHash?: string; error?: string };
    reward: {
      winnerTx: { success: boolean; transactionHash?: string; error?: string };
      verifierCut: string;
      winnerAmount: string;
    } | null;
  };
  individualResponses: {
    openai: { model: string; content: string; error?: string };
    gemini: { model: string; content: string; error?: string };
    claude: { model: string; content: string; error?: string };
  };
}

const EXPLORER = "https://testnet.kitescan.ai";

interface SpendingAgent {
  agent: AgentId;
  spent: number;
  cap: number;
  remaining: number;
  percent: number;
}

interface SecurityEvent {
  phase: "spending_cap" | "balance_check" | "escrow";
  status: "checking" | "passed" | "blocked";
  message: string;
  spending: { A: SpendingAgent; B: SpendingAgent; C: SpendingAgent };
  balances?: { A: { kite: string; usdt: string }; B: { kite: string; usdt: string }; C: { kite: string; usdt: string } };
  escrows?: {
    A: { success: boolean; transactionHash?: string; error?: string };
    B: { success: boolean; transactionHash?: string; error?: string };
    C: { success: boolean; transactionHash?: string; error?: string };
  };
}

// --- Curator types ---

interface CuratorClaim {
  id: number;
  text: string;
  sources: string[];
  status: "supported" | "inconclusive" | "contradicted";
  model: string;
  isNovel: boolean;
  sourceCount: number;
}

const MODEL_COLORS: Record<string, string> = { claude: "#8B5CF6", gemini: "#3B82F6", "gpt-4": "#10B981" };
const STATUS_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  supported: { bg: "#052e16", border: "#166534", text: "#4ade80", label: "Verified" },
  inconclusive: { bg: "#1a1a0a", border: "#854d0e", text: "#facc15", label: "Inconclusive" },
  contradicted: { bg: "#2a0a0a", border: "#991b1b", text: "#f87171", label: "Wrong" },
};

// --- Classifier utilities ---

const MODEL_KEY_ALIASES: Record<string, string[]> = {
  gpt: ["gpt", "gpt-4", "gpt-4o"],
  "gpt-4": ["gpt-4", "gpt", "gpt-4o"],
  gemini: ["gemini"],
  claude: ["claude"],
};

function resolveModelKeys(model: string): string[] {
  return MODEL_KEY_ALIASES[model] || [model];
}

const META_CLAIM_PATTERNS = [
  /\bAI assistant\b/i,
  /\bdoes not have information\b/i,
  /\bcannot provide\b/i,
  /\bknowledge cutoff\b/i,
  /\bconsulting reliable\b/i,
  /\brecommended to obtain\b/i,
  /\bI don'?t have access\b/i,
  /\bunable to (verify|confirm|provide)\b/i,
  /\bbeyond my (training|knowledge)\b/i,
  /\bas of my last (update|training)\b/i,
  /\breliable (news )?sources can provide\b/i,
  /\bofficial announcements can provide\b/i,
  /\bcheck .*(official|reliable|news)/i,
  /\bfor the (most )?(accurate|latest|up-to-date) information\b/i,
];

function isMetaClaim(claim: string): boolean {
  return META_CLAIM_PATTERNS.some((p) => p.test(claim));
}

function getClaimCategory(
  claim: string,
  model: string | undefined,
  classifierResult: ClassifierResult | null | undefined
): "majority" | "minority" | null {
  if (!classifierResult || !model) return null;
  const keys = resolveModelKeys(model);
  for (const key of keys) {
    const majorityForModel = classifierResult.majorityClaims?.[key];
    if (majorityForModel) {
      const allMaj = [
        ...(majorityForModel.supported || []),
        ...(majorityForModel.inconclusive || []),
        ...(majorityForModel.contradicted || []),
      ];
      if (allMaj.some((entry) => entry[0] === claim)) return "majority";
    }
  }
  return "minority";
}

function getClaimRefs(
  claim: string,
  model: string | undefined,
  classifierResult: ClassifierResult | null | undefined
): string[] {
  if (!classifierResult || !model) return [];
  const keys = resolveModelKeys(model);
  for (const bucket of [classifierResult.minorityClaims, classifierResult.majorityClaims]) {
    for (const key of keys) {
      const forModel = bucket?.[key];
      if (!forModel) continue;
      for (const status of ["supported", "inconclusive", "contradicted"] as const) {
        const entries = forModel[status] || [];
        for (const entry of entries) {
          if (entry[0] === claim && Array.isArray(entry[1])) return entry[1] as string[];
        }
      }
    }
  }
  return [];
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "- ");
}

const AGENT_LLM_LABELS: Record<string, string> = {
  claude: "Claude", gemini: "Gemini", "gpt-4": "GPT-4", gpt: "GPT-4",
};

const AGENT_SOURCE_MODEL: Record<AgentId, string> = {
  A: "gpt-4",
  B: "gemini",
  C: "claude",
};

// --- Data transformation ---

function transformClaimsForCurator(result: QueryResult): CuratorClaim[] {
  const claims: CuratorClaim[] = [];
  const classifierResult = result.verification.classifierResult;
  let id = 0;

  for (const c of result.verification.claims.allClaims) {
    if (isMetaClaim(c.claim)) continue;

    const modelKey = AGENT_SOURCE_MODEL[c.source];
    const category = getClaimCategory(c.claim, modelKey, classifierResult);
    const isNovel = category === "minority";
    const refs = getClaimRefs(c.claim, modelKey, classifierResult);

    // Check if contradicted in classifier
    let status: "supported" | "inconclusive" | "contradicted" = c.status;
    if (classifierResult) {
      const keys = resolveModelKeys(modelKey);
      for (const bucket of [classifierResult.minorityClaims, classifierResult.majorityClaims]) {
        for (const key of keys) {
          const forModel = bucket?.[key];
          if (!forModel) continue;
          for (const entry of forModel.contradicted || []) {
            if (entry[0] === c.claim) {
              status = "contradicted";
            }
          }
        }
      }
    }

    claims.push({
      id: id++,
      text: c.claim,
      sources: refs,
      status,
      model: modelKey,
      isNovel,
      sourceCount: refs.length,
    });
  }

  return claims;
}

// --- Main Page ---

const PHASE_LABELS: Record<string, string> = {
  spending_cap: "Spending Cap",
  balance_check: "On-Chain Balance",
  escrow: "Escrow",
};

const PHASE_ORDER = ["spending_cap", "balance_check", "escrow"] as const;

export default function Home() {
  // --- Existing query state ---
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [wallets, setWallets] = useState<Record<string, WalletInfo | { error: string }> | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Curator state ---
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [modelFilter, setModelFilter] = useState<Set<string>>(new Set(["claude", "gemini", "gpt-4"]));
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["supported", "inconclusive", "contradicted"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [novelOnly, setNovelOnly] = useState(false);
  const [expandedClaim, setExpandedClaim] = useState<number | null>(null);
  const [contextTab, setContextTab] = useState("question");
  const [showSecurity, setShowSecurity] = useState(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch("/api/wallets");
      if (res.ok) setWallets(await res.json());
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  useEffect(() => {
    if (!result) scrollToBottom();
  }, [steps, securityEvents, error, scrollToBottom, result]);

  // --- Curator memos ---
  const curatorClaims = useMemo<CuratorClaim[]>(() => {
    if (!result) return [];
    return transformClaimsForCurator(result);
  }, [result]);

  const curatorResponses = useMemo(() => {
    if (!result) return {};
    return {
      question: submittedQuery,
      claude: stripMarkdown(result.individualResponses.claude.content || ""),
      "gpt-4": stripMarkdown(result.individualResponses.openai.content || ""),
      gemini: stripMarkdown(result.individualResponses.gemini.content || ""),
    };
  }, [result, submittedQuery]);

  // Auto-select supported claims when result arrives
  useEffect(() => {
    if (curatorClaims.length > 0) {
      const init = new Set<number>();
      curatorClaims.forEach((c) => { if (c.status === "supported") init.add(c.id); });
      setSelected(init);
      setSearchQuery("");
      setNovelOnly(false);
      setModelFilter(new Set(["claude", "gemini", "gpt-4"]));
      setStatusFilter(new Set(["supported", "inconclusive", "contradicted"]));
      setExpandedClaim(null);
      setContextTab("question");
    }
  }, [curatorClaims]);

  const filtered = useMemo(() => {
    return curatorClaims.filter((c) => {
      if (!modelFilter.has(c.model)) return false;
      if (!statusFilter.has(c.status)) return false;
      if (novelOnly && !c.isNovel) return false;
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [curatorClaims, modelFilter, statusFilter, searchQuery, novelOnly]);

  const stats = useMemo(() => {
    const inDataset = filtered.filter((c) => selected.has(c.id)).length;
    const supported = filtered.filter((c) => c.status === "supported").length;
    const inconclusive = filtered.filter((c) => c.status === "inconclusive").length;
    const contradicted = filtered.filter((c) => c.status === "contradicted").length;
    const novel = filtered.filter((c) => c.isNovel).length;
    return { total: filtered.length, inDataset, supported, inconclusive, contradicted, novel };
  }, [filtered, selected]);

  // --- Curator callbacks ---
  const toggle = useCallback((id: number) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const bulkAction = useCallback((action: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const t = filtered;
      if (action === "add_supported") t.filter((c) => c.status === "supported").forEach((c) => next.add(c.id));
      if (action === "remove_contradicted") t.filter((c) => c.status === "contradicted").forEach((c) => next.delete(c.id));
      if (action === "add_inconclusive") t.filter((c) => c.status === "inconclusive").forEach((c) => next.add(c.id));
      if (action === "remove_inconclusive") t.filter((c) => c.status === "inconclusive").forEach((c) => next.delete(c.id));
      if (action === "add_novel_supported") t.filter((c) => c.isNovel && c.status === "supported").forEach((c) => next.add(c.id));
      if (action === "add_all") t.forEach((c) => next.add(c.id));
      if (action === "remove_all") t.forEach((c) => next.delete(c.id));
      if (action === "add_novel_inconclusive") t.filter((c) => c.isNovel && c.status === "inconclusive").forEach((c) => next.add(c.id));
      return next;
    });
  }, [filtered]);

  const doExport = useCallback(() => {
    const d = curatorClaims.filter((c) => selected.has(c.id));
    const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = "curated_training_data.json"; a.click();
    URL.revokeObjectURL(u);
  }, [selected, curatorClaims]);

  const toggleModel = (m: string) => { setModelFilter((p) => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; }); };
  const toggleStatus = (s: string) => { setStatusFilter((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; }); };

  const fmtSrc = (s: string) => {
    if (s.startsWith("http")) { try { return { display: new URL(s).hostname.replace("www.", ""), url: s }; } catch { return { display: s, url: s }; } }
    return { display: s, url: "https://" + s };
  };

  // --- SSE handler ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setSubmittedQuery(query);
    setQuery("");
    setLoading(true);
    setError("");
    setResult(null);
    setSteps([]);
    setSecurityEvents([]);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const match = line.match(/^data: (.+)$/);
          if (!match) continue;

          try {
            const event = JSON.parse(match[1]);
            if (event.type === "step") {
              setSteps((prev) => [...prev, event.data.message]);
            } else if (event.type === "security") {
              setSecurityEvents((prev) => [...prev, event.data as SecurityEvent]);
            } else if (event.type === "result") {
              setResult(event.data);
              fetchWallets();
            } else if (event.type === "error") {
              setError(event.data.message);
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const hasActivity = !!(submittedQuery || loading || result || error);
  const winner = result?.verification.claims.winner;

  // --- Pre-query / Loading mode ---
  if (!result) {
    return (
      <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#e0e0e0", fontFamily: "monospace", display: "flex", flexDirection: "column" }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
            {!hasActivity && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: "#e0e0e0", marginBottom: 4 }}>Minority Report</h1>
                <p style={{ color: "#666", fontSize: 13, marginBottom: 32 }}>
                  Multi-model AI orchestrator with VeriScore verification and Kite escrow
                </p>
                {wallets && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
                    {[
                      { key: "agentA", label: "Agent A (OpenAI)" },
                      { key: "agentB", label: "Agent B (Gemini)" },
                      { key: "agentC", label: "Agent C (Claude)" },
                      { key: "verifier", label: "Verifier" },
                    ].map(({ key, label }) => {
                      const data = wallets[key];
                      if (!data || "error" in data) return (
                        <div key={key} style={{ border: "1px solid #222", borderRadius: 6, padding: "8px 12px", fontSize: 11 }}>
                          <div style={{ color: "#666" }}>{label}</div>
                          <div style={{ color: "#f87171", fontSize: 10 }}>{(data as { error: string })?.error || "N/A"}</div>
                        </div>
                      );
                      const info = data as WalletInfo;
                      return (
                        <div key={key} style={{ border: "1px solid #222", borderRadius: 6, padding: "8px 12px", fontSize: 11 }}>
                          <div style={{ color: "#666", marginBottom: 4 }}>{label}</div>
                          <div style={{ color: "#888", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }} title={info.aaWallet}>{info.aaWallet}</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 10 }}>
                            <span style={{ color: "#666" }}>{parseFloat(info.balance.kite).toFixed(4)} KITE</span>
                            <span style={{ color: "#4ade80" }}>{parseFloat(info.balance.usdt).toFixed(2)} USDT</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Loading: step log + security pipeline */}
            {(loading || steps.length > 0 || securityEvents.length > 0 || error) && (
              <div>
                {submittedQuery && (
                  <div style={{ marginBottom: 16, padding: "10px 16px", background: "#111", border: "1px solid #222", borderRadius: 6, fontSize: 13, color: "#d4d4d4" }}>
                    <span style={{ color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Query</span>
                    <div style={{ marginTop: 4 }}>{submittedQuery}</div>
                  </div>
                )}

                {/* Security pipeline */}
                {securityEvents.length > 0 && (() => {
                  const latestByPhase: Record<string, SecurityEvent> = {};
                  for (const ev of securityEvents) latestByPhase[ev.phase] = ev;
                  const latestEvent = securityEvents[securityEvents.length - 1];
                  const spending = latestEvent.spending;
                  return (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid #222", borderRadius: 6, background: "#0d0d0d" }}>
                      <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, fontWeight: 700 }}>x402 Security Pipeline</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        {PHASE_ORDER.map((phase) => {
                          const ev = latestByPhase[phase];
                          const st = ev?.status || "pending";
                          const borderColor = st === "passed" ? "#166534" : st === "blocked" ? "#991b1b" : st === "checking" ? "#854d0e" : "#222";
                          const bgColor = st === "passed" ? "#052e16" : st === "blocked" ? "#2a0a0a" : st === "checking" ? "#1a1a0a" : "#111";
                          return (
                            <div key={phase} style={{ flex: 1, padding: "8px 12px", border: "1px solid " + borderColor, borderRadius: 4, background: bgColor }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {st === "checking" && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "2px solid #facc15", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />}
                                {st === "passed" && <span style={{ color: "#4ade80", fontSize: 12 }}>&#10003;</span>}
                                {st === "blocked" && <span style={{ color: "#f87171", fontSize: 12 }}>&#10007;</span>}
                                <span style={{ fontSize: 11, color: "#ccc" }}>{PHASE_LABELS[phase]}</span>
                              </div>
                              {ev && <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>{ev.message}</div>}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        {(["A", "B", "C"] as const).map((agent) => {
                          const d = spending[agent];
                          const pct = Math.min(d.percent, 100);
                          return (
                            <div key={agent} style={{ flex: 1, fontSize: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", color: "#666", marginBottom: 2 }}>
                                <span>Agent {agent}</span>
                                <span style={{ color: "#ccc" }}>{d.spent.toFixed(4)} / {d.cap} KITE</span>
                              </div>
                              <div style={{ height: 4, background: "#222", borderRadius: 2 }}>
                                <div style={{ height: 4, borderRadius: 2, width: pct + "%", background: pct > 90 ? "#f87171" : pct > 60 ? "#facc15" : "#4ade80" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Step log */}
                {steps.length > 0 && (
                  <div style={{ marginBottom: 16, padding: 16, border: "1px solid #222", borderRadius: 6, background: "#0d0d0d" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#facc15", animation: "pulse 2s infinite" }} />
                      <span style={{ fontSize: 10, color: "#facc15", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Live</span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      {steps.map((step, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 2 }}>
                          <span style={{ color: "#444", flexShrink: 0 }}>[{i + 1}]</span>
                          <span style={{
                            color: step.includes("failed") || step.includes("error") ? "#f87171"
                              : step.includes("escrowed") || step.includes("rewarded") || step.includes("Winner") ? "#4ade80"
                              : step.includes("VeriScore") || step.includes("Precision") ? "#facc15"
                              : step.includes("classifier") ? "#818cf8"
                              : "#ccc"
                          }}>{step}</span>
                        </div>
                      ))}
                      {loading && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#666" }}>
                          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "2px solid #333", borderTopColor: "#facc15", animation: "spin 1s linear infinite" }} />
                          <span>Processing...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {error && (
                  <div style={{ padding: 16, border: "1px solid #991b1b", borderRadius: 6, background: "#2a0a0a", color: "#f87171", fontSize: 13 }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input bar */}
        <div style={{ borderTop: "1px solid #222", padding: "12px 16px", background: "#0a0a0a" }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, maxWidth: 800, margin: "0 auto" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything..."
              disabled={loading}
              style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#ccc", padding: "10px 16px", borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none" }}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              style={{ background: loading ? "#333" : "#166534", color: loading ? "#666" : "#4ade80", border: "1px solid " + (loading ? "#333" : "#22c55e"), padding: "10px 20px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
            >
              {loading ? "Processing..." : "Ask"}
            </button>
          </form>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    );
  }

  // --- Post-query: Curator layout ---
  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#e0e0e0", fontFamily: "monospace", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #222", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#0a0a0a", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Minority Report</span>
          <span style={{ fontSize: 11, color: "#666", border: "1px solid #333", padding: "2px 8px", borderRadius: 4 }}>{stats.inDataset}/{stats.total} claims</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="New query..."
              style={{ background: "#111", border: "1px solid #333", color: "#ccc", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: "inherit", width: 200, outline: "none" }}
            />
            <button type="submit" style={{ background: "#166534", color: "#4ade80", border: "1px solid #22c55e", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>Ask</button>
          </form>
          <button onClick={doExport} style={{ background: "#166534", color: "#4ade80", border: "1px solid #22c55e", padding: "4px 16px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>Export {selected.size}</button>
        </div>
      </div>

      {/* Main scrollable content */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* Context Tabs (Question / Claude / GPT-4 / Gemini) */}
        <div style={{ borderBottom: "1px solid #222", background: "#080c14" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", padding: "0 24px" }}>
            {[
              { key: "question", label: "Question", color: "#f59e0b" },
              { key: "claude", label: "Claude", color: MODEL_COLORS.claude },
              { key: "gpt-4", label: "GPT-4", color: MODEL_COLORS["gpt-4"] },
              { key: "gemini", label: "Gemini", color: MODEL_COLORS.gemini },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setContextTab(tab.key)} style={{ background: "transparent", border: "none", borderBottom: contextTab === tab.key ? "2px solid " + tab.color : "2px solid transparent", color: contextTab === tab.key ? tab.color : "#555", padding: "10px 16px", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ padding: "16px 24px", maxHeight: 250, overflowY: "auto" }}>
            {contextTab === "question" ? (
              <div>
                <div style={{ fontSize: 10, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>Original Question</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: "#d4d4d4" }}>{curatorResponses.question || submittedQuery}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 10, color: MODEL_COLORS[contextTab] || "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>
                  {contextTab} response | {curatorClaims.filter(c => c.model === contextTab).length} claims extracted
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.7, color: "#b0b0b0", whiteSpace: "pre-wrap" }}>{curatorResponses[contextTab as keyof typeof curatorResponses] || ""}</div>
              </div>
            )}
          </div>
        </div>

        {/* Scores + Security row */}
        <div style={{ borderBottom: "1px solid #222", padding: "12px 24px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {/* Precision scores */}
          {([
            { label: "OpenAI", score: result.verification.scores.agentA, agent: "A" as AgentId },
            { label: "Gemini", score: result.verification.scores.agentB, agent: "B" as AgentId },
            { label: "Claude", score: result.verification.scores.agentC, agent: "C" as AgentId },
          ]).map(({ label, score, agent }) => {
            const pct = Math.round(score.precision * 100);
            const isWinner = winner === agent;
            return (
              <div key={agent} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", border: "1px solid " + (isWinner ? "#22c55e" : "#222"), borderRadius: 4, background: isWinner ? "#052e16" : "transparent" }}>
                <span style={{ fontSize: 11, color: "#888" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: isWinner ? "#4ade80" : "#ccc" }}>{pct}%</span>
                {isWinner && <span style={{ fontSize: 9, color: "#4ade80", textTransform: "uppercase", fontWeight: 700 }}>Winner</span>}
                <span style={{ fontSize: 9, color: "#555" }}>{score.supported}/{score.total}</span>
              </div>
            );
          })}

          <div style={{ flex: 1 }} />

          {/* Security toggle */}
          {(securityEvents.length > 0 || result.transactions) && (
            <button onClick={() => setShowSecurity(!showSecurity)} style={{ background: "transparent", border: "1px solid #333", color: "#666", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
              {showSecurity ? "Hide" : "Show"} x402 / Txns
            </button>
          )}
        </div>

        {/* Collapsible security + transaction info */}
        {showSecurity && (
          <div style={{ borderBottom: "1px solid #222", padding: "12px 24px", background: "#0d0d0d" }}>
            {/* Security pipeline */}
            {securityEvents.length > 0 && (() => {
              const latestByPhase: Record<string, SecurityEvent> = {};
              for (const ev of securityEvents) latestByPhase[ev.phase] = ev;
              const latestEvent = securityEvents[securityEvents.length - 1];
              const spending = latestEvent.spending;
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>x402 Security</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    {PHASE_ORDER.map((phase) => {
                      const ev = latestByPhase[phase];
                      const st = ev?.status || "pending";
                      return (
                        <div key={phase} style={{ padding: "4px 10px", border: "1px solid " + (st === "passed" ? "#166534" : st === "blocked" ? "#991b1b" : "#333"), borderRadius: 4, background: st === "passed" ? "#052e16" : st === "blocked" ? "#2a0a0a" : "#111", fontSize: 10 }}>
                          <span style={{ color: st === "passed" ? "#4ade80" : st === "blocked" ? "#f87171" : "#888" }}>
                            {st === "passed" ? "✓" : st === "blocked" ? "✗" : "..."} {PHASE_LABELS[phase]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
                    {(["A", "B", "C"] as const).map((a) => (
                      <span key={a} style={{ color: "#666" }}>Agent {a}: {spending[a].spent.toFixed(4)}/{spending[a].cap} KITE ({spending[a].percent.toFixed(1)}%)</span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Transactions */}
            <div>
              <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>Kite Transactions</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11 }}>
                {([
                  { label: "Escrow A", tx: result.transactions.escrowA },
                  { label: "Escrow B", tx: result.transactions.escrowB },
                  { label: "Escrow C", tx: result.transactions.escrowC },
                ]).map(({ label, tx }) => (
                  <div key={label} style={{ color: "#888" }}>
                    {label}: {tx.transactionHash ? (
                      <a href={`${EXPLORER}/tx/${tx.transactionHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#4a9eff", textDecoration: "none" }}>
                        {tx.transactionHash.slice(0, 10)}...
                      </a>
                    ) : "-"}
                  </div>
                ))}
                {result.transactions.reward && (
                  <div style={{ color: "#888" }}>
                    Reward ({result.transactions.reward.winnerAmount} KITE): {result.transactions.reward.winnerTx.transactionHash ? (
                      <a href={`${EXPLORER}/tx/${result.transactions.reward.winnerTx.transactionHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#4a9eff", textDecoration: "none" }}>
                        {result.transactions.reward.winnerTx.transactionHash.slice(0, 10)}...
                      </a>
                    ) : "-"}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div style={{ borderBottom: "1px solid #1a1a1a", padding: "12px 24px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {Object.entries(MODEL_COLORS).map(([model, color]) => (
            <button key={model} onClick={() => toggleModel(model)} style={{ background: modelFilter.has(model) ? color + "22" : "transparent", border: "1px solid " + (modelFilter.has(model) ? color : "#333"), color: modelFilter.has(model) ? color : "#555", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 600, textTransform: "uppercase" }}>{model}</button>
          ))}
          <div style={{ width: 1, height: 20, background: "#333", margin: "0 4px" }} />
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
            <button key={status} onClick={() => toggleStatus(status)} style={{ background: statusFilter.has(status) ? cfg.bg : "transparent", border: "1px solid " + (statusFilter.has(status) ? cfg.border : "#333"), color: statusFilter.has(status) ? cfg.text : "#555", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
              {cfg.label} ({status === "supported" ? stats.supported : status === "inconclusive" ? stats.inconclusive : stats.contradicted})
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: "#333", margin: "0 4px" }} />
          <button onClick={() => setNovelOnly(!novelOnly)} style={{ background: novelOnly ? "#312e81" : "transparent", border: "1px solid " + (novelOnly ? "#6366f1" : "#333"), color: novelOnly ? "#a5b4fc" : "#555", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Novel only ({stats.novel})</button>
          <div style={{ flex: 1 }} />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search claims..." style={{ background: "#111", border: "1px solid #333", color: "#ccc", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: "inherit", width: 200, outline: "none" }} />
        </div>

        {/* Bulk actions */}
        <div style={{ borderBottom: "1px solid #1a1a1a", padding: "8px 24px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#555", lineHeight: "24px", marginRight: 8, textTransform: "uppercase", letterSpacing: 1 }}>Quick:</span>
          {([
            ["add_supported", "+ Verified", "#166534"],
            ["remove_contradicted", "- Wrong", "#991b1b"],
            ["add_inconclusive", "+ Inconclusive", "#854d0e"],
            ["remove_inconclusive", "- Inconclusive", "#854d0e"],
            ["add_novel_supported", "+ Novel verified", "#312e81"],
            ["add_novel_inconclusive", "+ Novel inconclusive", "#312e81"],
            ["add_all", "+ All", "#333"],
            ["remove_all", "- All", "#333"],
          ] as const).map(([action, label, color]) => (
            <button key={action} onClick={() => bulkAction(action)} style={{ background: "transparent", border: "1px solid " + color, color: "#888", padding: "2px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>{label}</button>
          ))}
        </div>

        {/* Claims list */}
        <div style={{ padding: "8px 24px" }}>
          {filtered.map((claim) => {
            const isIn = selected.has(claim.id);
            const cfg = STATUS_CONFIG[claim.status];
            const isExp = expandedClaim === claim.id;
            return (
              <div key={claim.id} onClick={() => toggle(claim.id)} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", marginBottom: 2, borderRadius: 6, background: isIn ? "#0d1117" : "transparent", border: "1px solid " + (isIn ? "#1e3a2f" : "transparent"), cursor: "pointer" }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (isIn ? "#22c55e" : "#333"), background: isIn ? "#22c55e" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  {isIn && <span style={{ color: "#000", fontSize: 12, fontWeight: 900 }}>&#10003;</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: cfg.bg, border: "1px solid " + cfg.border, color: cfg.text, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{cfg.label}</span>
                    <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: MODEL_COLORS[claim.model] + "18", border: "1px solid " + MODEL_COLORS[claim.model] + "44", color: MODEL_COLORS[claim.model] }}>{claim.model}</span>
                    {claim.isNovel && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "#1e1b4b", border: "1px solid #4338ca", color: "#818cf8", fontWeight: 600 }}>Novel</span>}
                    <span style={{ fontSize: 9, color: "#555", marginLeft: "auto" }}>{claim.sourceCount} sources</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: isIn ? "#d4d4d4" : "#777" }}>{claim.text}</div>
                  {isExp && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #222" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>Sources</div>
                      {claim.sources.map((s, i) => {
                        const src = fmtSrc(s);
                        return <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 11, color: "#4a9eff", marginBottom: 4, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.startsWith("http") ? s : src.display}</a>;
                      })}
                      {claim.sourceCount > claim.sources.length && <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>+ {claim.sourceCount - claim.sources.length} more</div>}
                    </div>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setExpandedClaim(isExp ? null : claim.id); }} style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0 }}>{isExp ? "\u25BE" : "\u25B8"}</button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>
              No claims match the current filters.
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{ position: "sticky", bottom: 0, background: "#0a0a0a", borderTop: "1px solid #222", padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ color: "#4ade80" }}>Verified: {filtered.filter(c => selected.has(c.id) && c.status === "supported").length}</span>
          <span style={{ color: "#facc15" }}>Inconclusive: {filtered.filter(c => selected.has(c.id) && c.status === "inconclusive").length}</span>
          <span style={{ color: "#f87171" }}>Wrong: {filtered.filter(c => selected.has(c.id) && c.status === "contradicted").length}</span>
          <span style={{ color: "#818cf8" }}>Novel: {filtered.filter(c => selected.has(c.id) && c.isNovel).length}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#22c55e" }}>{selected.size} in dataset</div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
    </div>
  );
}
