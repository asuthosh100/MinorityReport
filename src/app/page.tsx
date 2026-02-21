"use client";

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";

type AgentId = "A" | "B" | "C";

const AGENT_NAMES: Record<AgentId, string> = {
  A: "OpenAI",
  B: "Gemini",
  C: "Claude",
};

interface ClaimClassification {
  claim: string;
  originalText: string;
  source: AgentId;
  status: "supported" | "contradicted" | "inconclusive" | "novel";
}

interface AgentScore {
  total: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  novel: number;
  precision: number;
  recallAtK: number;
  veriScore: number;
}

interface WalletInfo {
  agent: string;
  eoa: string;
  aaWallet: string;
  balance: { kite: string; usdt: string };
}

interface QueryResult {
  verification: {
    claims: {
      allClaims: ClaimClassification[];
      consensusInsights: string[];
      novelInsights: { agent: AgentId; insight: string }[];
      bestNovelInsight: { agent: AgentId; insight: string; reasoning: string };
      winner: AgentId;
    };
    scores: {
      K: number;
      agentA: AgentScore;
      agentB: AgentScore;
      agentC: AgentScore;
    };
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

function statusColor(status: string) {
  switch (status) {
    case "supported":
      return "bg-green-100 dark:bg-green-900/30";
    case "contradicted":
      return "bg-red-100 dark:bg-red-900/30";
    case "inconclusive":
      return "bg-yellow-100 dark:bg-yellow-900/30";
    case "novel":
      return "border-l-4 border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
    default:
      return "";
  }
}

function buildSegments(content: string, claims: ClaimClassification[]): { text: string; status?: string }[] {
  if (!claims.length) return [{ text: content }];

  const segments: { text: string; status?: string }[] = [];
  let remaining = content;

  const sortedClaims = [...claims].sort((a, b) => {
    const posA = content.indexOf(a.originalText);
    const posB = content.indexOf(b.originalText);
    return posA - posB;
  });

  for (const claim of sortedClaims) {
    const idx = remaining.indexOf(claim.originalText);
    if (idx === -1) continue;
    if (idx > 0) segments.push({ text: remaining.slice(0, idx) });
    segments.push({ text: claim.originalText, status: claim.status });
    remaining = remaining.slice(idx + claim.originalText.length);
  }

  if (remaining) segments.push({ text: remaining });
  return segments.length > 0 ? segments : [{ text: content }];
}

function StreamingResponse({
  content,
  claims,
}: {
  content: string;
  claims: ClaimClassification[];
}) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    if (!content) return;

    let raf: number;
    let current = 0;

    function tick() {
      // Advance ~4 words per frame for a natural flow
      for (let w = 0; w < 4; w++) {
        const next = content.indexOf(" ", current + 1);
        current = next === -1 ? content.length : next + 1;
      }
      setRevealed(Math.min(current, content.length));

      if (current < content.length) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [content]);

  const done = revealed >= content.length;
  const segments = buildSegments(content, claims);

  let charsLeft = revealed;
  return (
    <div className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
      {segments.map((seg, i) => {
        if (charsLeft <= 0) return null;
        const visLen = Math.min(seg.text.length, charsLeft);
        charsLeft -= visLen;
        const visText = seg.text.slice(0, visLen);

        return seg.status ? (
          <span key={i} className={`inline rounded px-1 py-0.5 ${statusColor(seg.status)}`}>
            {visText}
          </span>
        ) : (
          <span key={i}>{visText}</span>
        );
      })}
      {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-zinc-500 align-text-bottom dark:bg-zinc-400" />}
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: AgentScore }) {
  const pct = Math.round(score.veriScore * 100);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">{label}</h3>
      <div className="mb-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">{pct}%</div>
      <div className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex justify-between">
          <span>Total claims</span>
          <span className="font-mono">{score.total}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-600">Supported</span>
          <span className="font-mono">{score.supported}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-red-600">Contradicted</span>
          <span className="font-mono">{score.contradicted}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-yellow-600">Inconclusive</span>
          <span className="font-mono">{score.inconclusive}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-500">Novel</span>
          <span className="font-mono">{score.novel}</span>
        </div>
        <hr className="border-zinc-200 dark:border-zinc-700" />
        <div className="flex justify-between">
          <span>Precision</span>
          <span className="font-mono">{score.precision}</span>
        </div>
        <div className="flex justify-between">
          <span>Recall@K</span>
          <span className="font-mono">{score.recallAtK}</span>
        </div>
      </div>
    </div>
  );
}

function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="text-zinc-400">-</span>;
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-blue-600 underline dark:text-blue-400"
    >
      {hash.slice(0, 10)}...{hash.slice(-6)}
    </a>
  );
}

function WalletPanel({ wallets }: { wallets: Record<string, WalletInfo | { error: string }> | null }) {
  if (!wallets) return null;

  const agents = [
    { key: "agentA", label: "Agent A (OpenAI)" },
    { key: "agentB", label: "Agent B (Gemini)" },
    { key: "agentC", label: "Agent C (Claude)" },
    { key: "verifier", label: "Verifier (Claude)" },
  ];

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
      {agents.map(({ key, label }) => {
        const data = wallets[key];
        if (!data || "error" in data) {
          return (
            <div key={key} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="text-xs font-semibold text-zinc-500">{label}</h3>
              <p className="mt-1 text-xs text-red-500">{(data as { error: string })?.error || "Not configured"}</p>
            </div>
          );
        }
        const info = data as WalletInfo;
        return (
          <div key={key} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{label}</h3>
            <p className="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400 truncate" title={info.aaWallet}>
              {info.aaWallet}
            </p>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-zinc-500">{parseFloat(info.balance.kite).toFixed(4)} KITE</span>
              <span className="text-emerald-500">{parseFloat(info.balance.usdt).toFixed(2)} USDT</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  spending_cap: "Spending Cap",
  balance_check: "On-Chain Balance",
  escrow: "Escrow",
};

const PHASE_ORDER = ["spending_cap", "balance_check", "escrow"] as const;

function StatusIcon({ status }: { status: string }) {
  if (status === "checking") return <div className="h-3 w-3 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />;
  if (status === "passed") return <span className="text-green-400 text-sm">&#10003;</span>;
  if (status === "blocked") return <span className="text-red-400 text-sm">&#10007;</span>;
  return <div className="h-3 w-3 rounded-full bg-zinc-600" />;
}

function SpendingBar({ agent, data }: { agent: string; data: SpendingAgent }) {
  const pct = Math.min(data.percent, 100);
  const barColor = pct > 90 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">Agent {agent}</span>
        <span className="font-mono text-zinc-300">{data.spent.toFixed(4)} / {data.cap} KITE</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-700">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>{pct.toFixed(1)}% used</span>
        <span>{data.remaining.toFixed(4)} remaining</span>
      </div>
    </div>
  );
}

function SecurityPanel({ events }: { events: SecurityEvent[] }) {
  if (events.length === 0) return null;

  // Get the latest event per phase
  const latestByPhase: Record<string, SecurityEvent> = {};
  for (const e of events) {
    latestByPhase[e.phase] = e;
  }

  // Get the most recent spending state
  const latestEvent = events[events.length - 1];
  const spending = latestEvent.spending;

  return (
    <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">x402 Security</span>
      </div>

      {/* Spending bars */}
      <div className="mb-4 grid grid-cols-3 gap-4">
        <SpendingBar agent="A" data={spending.A} />
        <SpendingBar agent="B" data={spending.B} />
        <SpendingBar agent="C" data={spending.C} />
      </div>

      {/* Phase chain */}
      <div className="flex items-center gap-1">
        {PHASE_ORDER.map((phase, i) => {
          const ev = latestByPhase[phase];
          const status = ev?.status || "pending";
          const bgClass =
            status === "passed" ? "border-green-800 bg-green-950/50" :
            status === "blocked" ? "border-red-800 bg-red-950/50" :
            status === "checking" ? "border-yellow-800 bg-yellow-950/50" :
            "border-zinc-700 bg-zinc-800/50";

          return (
            <div key={phase} className="flex items-center gap-1">
              {i > 0 && (
                <div className={`h-px w-4 ${status === "passed" ? "bg-green-600" : status === "blocked" ? "bg-red-600" : "bg-zinc-600"}`} />
              )}
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${bgClass}`}>
                <StatusIcon status={status} />
                <div>
                  <div className="text-xs font-medium text-zinc-200">{PHASE_LABELS[phase]}</div>
                  {ev && (
                    <div className="text-[10px] text-zinc-400">{ev.message}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Balance details if available */}
      {latestByPhase.balance_check?.balances && latestByPhase.balance_check.status === "passed" && (
        <div className="mt-3 grid grid-cols-3 gap-4 text-xs text-zinc-400">
          <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
            <span>Agent A on-chain</span>
            <span className="font-mono text-zinc-200">{parseFloat(latestByPhase.balance_check.balances.A.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
            <span>Agent B on-chain</span>
            <span className="font-mono text-zinc-200">{parseFloat(latestByPhase.balance_check.balances.B.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
            <span>Agent C on-chain</span>
            <span className="font-mono text-zinc-200">{parseFloat(latestByPhase.balance_check.balances.C.kite).toFixed(4)} KITE</span>
          </div>
        </div>
      )}

      {/* Escrow tx hashes if available */}
      {latestByPhase.escrow?.escrows && latestByPhase.escrow.status === "passed" && (
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs text-zinc-400">
          {latestByPhase.escrow.escrows.A.transactionHash && (
            <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
              <span>Agent A escrow tx</span>
              <a
                href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.A.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-400 underline"
              >
                {latestByPhase.escrow.escrows.A.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.B.transactionHash && (
            <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
              <span>Agent B escrow tx</span>
              <a
                href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.B.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-400 underline"
              >
                {latestByPhase.escrow.escrows.B.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.C.transactionHash && (
            <div className="flex justify-between rounded bg-zinc-800 px-2 py-1">
              <span>Agent C escrow tx</span>
              <a
                href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.C.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-400 underline"
              >
                {latestByPhase.escrow.escrows.C.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        {children}
      </div>
    </div>
  );
}

const LEFT_MIN = 320;
const LEFT_MAX = 600;
const LEFT_DEFAULT = 420;

function DragHandle({
  onDrag,
}: {
  onDrag: (deltaX: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(dx);
    }
    function onMouseUp() {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center"
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
    >
      <div className="h-8 w-1 rounded-full bg-zinc-300 transition-colors group-hover:bg-zinc-500 dark:bg-zinc-700 dark:group-hover:bg-zinc-500" />
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [wallets, setWallets] = useState<Record<string, WalletInfo | { error: string }> | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [overlay, setOverlay] = useState<"security" | "transactions" | null>(null);

  const handleDrag = useCallback((deltaX: number) => {
    setLeftWidth((w) => Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + deltaX)));
  }, []);

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

  // Auto-scroll when new content appears
  useEffect(() => {
    scrollToBottom();
  }, [steps, securityEvents, result, error, submittedQuery, scrollToBottom]);

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

  const agentAClaims = result?.verification.claims.allClaims.filter((c) => c.source === "A") || [];
  const agentBClaims = result?.verification.claims.allClaims.filter((c) => c.source === "B") || [];
  const agentCClaims = result?.verification.claims.allClaims.filter((c) => c.source === "C") || [];

  const hasActivity = !!(submittedQuery || loading || result || error);

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Narrow centered column for idle state + processing */}
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
          {/* Header + wallets — only when idle */}
          {!hasActivity && (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
              <h1 className="mb-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Sniper
              </h1>
              <p className="mb-8 text-zinc-500 dark:text-zinc-400">
                Multi-model AI orchestrator with VeriScore verification and Kite escrow
              </p>
              <WalletPanel wallets={wallets} />
            </div>
          )}

          {/* User query bubble */}
          {submittedQuery && (
            <div className="mb-4 flex justify-end">
              <div className="max-w-[70%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-3 text-sm text-zinc-100 dark:bg-zinc-800">
                {submittedQuery}
              </div>
            </div>
          )}

          {/* Processing state — stays in narrow column */}
          {(loading || (!result && (securityEvents.length > 0 || steps.length > 0 || error))) && (
            <div className="mb-4">
              {securityEvents.length > 0 && (
                <SecurityPanel events={securityEvents} />
              )}

              {(loading || steps.length > 0) && (
                <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-900 p-4 font-mono text-sm dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-green-400">Live</span>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {steps.map((step, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="shrink-0 text-zinc-500">[{i + 1}]</span>
                        <span className={
                          step.includes("failed") || step.includes("error")
                            ? "text-red-400"
                            : step.includes("escrowed") || step.includes("rewarded") || step.includes("Winner")
                              ? "text-green-400"
                              : step.includes("VeriScore")
                                ? "text-yellow-400"
                                : "text-zinc-300"
                        }>
                          {step}
                        </span>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <div className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
                        <span>Processing...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Full-width results layout — left sidebar (security/tx) | drag handle | right (main content) */}
        {result && (
          <div className="w-full px-4 pb-6">
            {error && (
              <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex">
              {/* Left sidebar — x402 Security + Kite Transactions + VeriScores */}
              <div className="hidden shrink-0 xl:block overflow-y-auto pr-1" style={{ width: leftWidth }}>
                <div className="sticky top-6 space-y-4">
                  {securityEvents.length > 0 && (
                    <div
                      className="cursor-pointer rounded-lg ring-zinc-600 transition-all hover:ring-2"
                      onClick={() => setOverlay("security")}
                      title="Click to expand"
                    >
                      <SecurityPanel events={securityEvents} />
                    </div>
                  )}

                  <div
                    className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-4 ring-zinc-600 transition-all hover:ring-2 dark:border-zinc-800 dark:bg-zinc-900"
                    onClick={() => setOverlay("transactions")}
                    title="Click to expand"
                  >
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Kite Transactions
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent A Escrow</span>
                        <TxLink hash={result.transactions.escrowA.transactionHash} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent B Escrow</span>
                        <TxLink hash={result.transactions.escrowB.transactionHash} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent C Escrow</span>
                        <TxLink hash={result.transactions.escrowC.transactionHash} />
                      </div>
                      {result.transactions.reward && (
                        <>
                          <hr className="border-zinc-200 dark:border-zinc-700" />
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Winner Reward ({result.transactions.reward.winnerAmount} KITE)</span>
                            <TxLink hash={result.transactions.reward.winnerTx.transactionHash} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Verifier Cut ({result.transactions.reward.verifierCut} KITE)</span>
                            <span className="text-xs text-zinc-400">retained</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <ScoreCard label="Agent A — OpenAI" score={result.verification.scores.agentA} />
                  <ScoreCard label="Agent B — Gemini" score={result.verification.scores.agentB} />
                  <ScoreCard label="Agent C — Claude" score={result.verification.scores.agentC} />
                </div>
              </div>

              {/* Drag handle — visible on xl+ */}
              <div className="hidden xl:flex">
                <DragHandle onDrag={handleDrag} />
              </div>

              {/* Right — main content */}
              <div className="min-w-0 flex-1 space-y-5 pl-1">
                {/* VeriScore Cards — visible on smaller screens where left sidebar is hidden */}
                <div className="grid grid-cols-3 gap-4 xl:hidden">
                  <ScoreCard label="Agent A — OpenAI" score={result.verification.scores.agentA} />
                  <ScoreCard label="Agent B — Gemini" score={result.verification.scores.agentB} />
                  <ScoreCard label="Agent C — Claude" score={result.verification.scores.agentC} />
                </div>

                {/* Winner */}
                <div className="rounded-lg border-2 border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                  <span className="text-lg font-bold text-green-700 dark:text-green-400">
                    Winner: Agent {result.verification.claims.winner} ({AGENT_NAMES[result.verification.claims.winner]})
                  </span>
                  <p className="mt-2 text-sm text-green-800 dark:text-green-300">
                    <strong>Best novel insight:</strong> {result.verification.claims.bestNovelInsight.insight}
                  </p>
                  <p className="mt-1 text-xs text-green-600 dark:text-green-500">
                    {result.verification.claims.bestNovelInsight.reasoning}
                  </p>
                </div>

                {/* Agent Responses */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {/* Agent A */}
                  <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Agent A — {result.individualResponses.openai.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-200 px-1.5 py-0.5 text-green-800 dark:bg-green-800 dark:text-green-200">
                          {agentAClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-red-200 px-1.5 py-0.5 text-red-800 dark:bg-red-800 dark:text-red-200">
                          {agentAClaims.filter((c) => c.status === "contradicted").length} contradicted
                        </span>
                        <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                          {agentAClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                        <span className="rounded bg-green-300 px-1.5 py-0.5 text-green-900 dark:bg-green-700 dark:text-green-100">
                          {agentAClaims.filter((c) => c.status === "novel").length} novel
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.openai.error ? (
                        <p className="text-red-500">{result.individualResponses.openai.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.openai.content} claims={agentAClaims} />
                      )}
                    </div>
                  </div>

                  {/* Agent B */}
                  <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Agent B — {result.individualResponses.gemini.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-200 px-1.5 py-0.5 text-green-800 dark:bg-green-800 dark:text-green-200">
                          {agentBClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-red-200 px-1.5 py-0.5 text-red-800 dark:bg-red-800 dark:text-red-200">
                          {agentBClaims.filter((c) => c.status === "contradicted").length} contradicted
                        </span>
                        <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                          {agentBClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                        <span className="rounded bg-green-300 px-1.5 py-0.5 text-green-900 dark:bg-green-700 dark:text-green-100">
                          {agentBClaims.filter((c) => c.status === "novel").length} novel
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.gemini.error ? (
                        <p className="text-red-500">{result.individualResponses.gemini.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.gemini.content} claims={agentBClaims} />
                      )}
                    </div>
                  </div>

                  {/* Agent C */}
                  <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Agent C — {result.individualResponses.claude.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-200 px-1.5 py-0.5 text-green-800 dark:bg-green-800 dark:text-green-200">
                          {agentCClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-red-200 px-1.5 py-0.5 text-red-800 dark:bg-red-800 dark:text-red-200">
                          {agentCClaims.filter((c) => c.status === "contradicted").length} contradicted
                        </span>
                        <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                          {agentCClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                        <span className="rounded bg-green-300 px-1.5 py-0.5 text-green-900 dark:bg-green-700 dark:text-green-100">
                          {agentCClaims.filter((c) => c.status === "novel").length} novel
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.claude.error ? (
                        <p className="text-red-500">{result.individualResponses.claude.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.claude.content} claims={agentCClaims} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Combined Analysis */}
                {result.verification.claims.consensusInsights.length > 0 && (
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Consensus Insights (Multiple Agents Agree)
                    </h3>
                    <ul className="space-y-1">
                      {result.verification.claims.consensusInsights.map((insight, i) => (
                        <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">{insight}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.verification.claims.novelInsights.length > 0 && (
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Novel Insights
                    </h3>
                    <ul className="space-y-2">
                      {result.verification.claims.novelInsights.map((n, i) => (
                        <li key={i} className="rounded border-l-4 border-green-500 bg-green-50 p-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          <span className="mr-2 rounded bg-green-200 px-1.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-800 dark:text-green-200">
                            Agent {n.agent}
                          </span>
                          {n.insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* x402 + Kite Transactions — visible on smaller screens below content */}
                <div className="space-y-4 xl:hidden">
                  {securityEvents.length > 0 && (
                    <div
                      className="cursor-pointer rounded-lg ring-zinc-600 transition-all hover:ring-2"
                      onClick={() => setOverlay("security")}
                      title="Click to expand"
                    >
                      <SecurityPanel events={securityEvents} />
                    </div>
                  )}
                  <div
                    className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-4 ring-zinc-600 transition-all hover:ring-2 dark:border-zinc-800 dark:bg-zinc-900"
                    onClick={() => setOverlay("transactions")}
                    title="Click to expand"
                  >
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Kite Transactions
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent A Escrow</span>
                        <TxLink hash={result.transactions.escrowA.transactionHash} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent B Escrow</span>
                        <TxLink hash={result.transactions.escrowB.transactionHash} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-600 dark:text-zinc-400">Agent C Escrow</span>
                        <TxLink hash={result.transactions.escrowC.transactionHash} />
                      </div>
                      {result.transactions.reward && (
                        <>
                          <hr className="border-zinc-200 dark:border-zinc-700" />
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Winner Reward ({result.transactions.reward.winnerAmount} KITE)</span>
                            <TxLink hash={result.transactions.reward.winnerTx.transactionHash} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Verifier Cut ({result.transactions.reward.verifierCut} KITE)</span>
                            <span className="text-xs text-zinc-400">retained</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Security overlay */}
            {overlay === "security" && securityEvents.length > 0 && (
              <Overlay onClose={() => setOverlay(null)} wide>
                <SecurityPanel events={securityEvents} />
              </Overlay>
            )}

            {/* Transactions overlay */}
            {overlay === "transactions" && (
              <Overlay onClose={() => setOverlay(null)}>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Kite Transactions
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
                    <span className="text-zinc-300">Agent A Escrow</span>
                    <TxLink hash={result.transactions.escrowA.transactionHash} />
                  </div>
                  <div className="flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
                    <span className="text-zinc-300">Agent B Escrow</span>
                    <TxLink hash={result.transactions.escrowB.transactionHash} />
                  </div>
                  <div className="flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
                    <span className="text-zinc-300">Agent C Escrow</span>
                    <TxLink hash={result.transactions.escrowC.transactionHash} />
                  </div>
                  {result.transactions.reward && (
                    <>
                      <hr className="border-zinc-700" />
                      <div className="flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
                        <span className="text-zinc-300">Winner Reward ({result.transactions.reward.winnerAmount} KITE)</span>
                        <TxLink hash={result.transactions.reward.winnerTx.transactionHash} />
                      </div>
                      <div className="flex items-center justify-between rounded bg-zinc-800 px-3 py-2">
                        <span className="text-zinc-300">Verifier Cut ({result.transactions.reward.verifierCut} KITE)</span>
                        <span className="text-xs text-zinc-400">retained</span>
                      </div>
                    </>
                  )}
                </div>
              </Overlay>
            )}
          </div>
        )}
      </div>

      {/* Input bar — pinned to bottom */}
      <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-black">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-4xl gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything..."
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-xl bg-zinc-900 px-6 py-3 font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Processing..." : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}
