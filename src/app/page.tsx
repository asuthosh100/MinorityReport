"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
      return "bg-green-50 text-green-800";
    case "inconclusive":
      return "bg-amber-50 text-amber-800";
    default:
      return "";
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "- ");
}

function StreamingResponse({ content: raw }: { content: string }) {
  const content = stripMarkdown(raw);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    if (!content) return;

    let raf: number;
    let current = 0;

    function tick() {
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
  const visText = content.slice(0, revealed);

  return (
    <div className="text-stone-700 whitespace-pre-wrap">
      {visText}
      {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-stone-400 align-text-bottom" />}
    </div>
  );
}

function ScoreCard({ label, score, isWinner }: { label: string; score: AgentScore; isWinner: boolean }) {
  const pct = Math.round(score.precision * 100);
  return (
    <div className={`rounded-lg border p-4 ${isWinner ? "border-amber-500 bg-amber-50" : "border-stone-200 bg-white"}`}>
      <h3 className="mb-2 text-sm font-semibold text-stone-500">{label}</h3>
      <div className={`mb-3 text-3xl font-bold ${isWinner ? "text-amber-700" : "text-stone-900"}`}>
        {pct}%
        {isWinner && <span className="ml-2 text-sm font-normal text-amber-600">WINNER</span>}
      </div>
      <div className="space-y-1.5 text-xs text-stone-500">
        <div className="flex justify-between">
          <span>Total claims</span>
          <span className="font-mono text-stone-800">{score.total}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-600">Supported</span>
          <span className="font-mono text-green-700">{score.supported}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-amber-600">Inconclusive</span>
          <span className="font-mono text-amber-700">{score.inconclusive}</span>
        </div>
        <hr className="border-stone-200" />
        <div className="flex justify-between font-medium">
          <span className="text-stone-700">Precision</span>
          <span className="font-mono text-stone-900">{(score.precision * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function ClaimsList({ claims }: { claims: ClaimClassification[] }) {
  if (claims.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5 border-t border-stone-200 pt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Verified Claims</h4>
      {claims.map((c, i) => (
        <div key={i} className={`rounded px-2 py-1.5 text-xs ${statusColor(c.status)}`}>
          <span className={`mr-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-bold uppercase ${
            c.status === "supported" ? "bg-green-600 text-white" : "bg-amber-500 text-white"
          }`}>
            {c.status}
          </span>
          {c.claim}
        </div>
      ))}
    </div>
  );
}

function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="text-stone-400">-</span>;
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-blue-600 underline"
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
            <div key={key} className="rounded-lg border border-stone-200 bg-white p-3">
              <h3 className="text-xs font-semibold text-stone-500">{label}</h3>
              <p className="mt-1 text-xs text-red-500">{(data as { error: string })?.error || "Not configured"}</p>
            </div>
          );
        }
        const info = data as WalletInfo;
        return (
          <div key={key} className="rounded-lg border border-stone-200 bg-white p-3">
            <h3 className="text-xs font-semibold text-stone-500">{label}</h3>
            <p className="mt-1 font-mono text-xs text-stone-600 truncate" title={info.aaWallet}>
              {info.aaWallet}
            </p>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-stone-500">{parseFloat(info.balance.kite).toFixed(4)} KITE</span>
              <span className="text-emerald-600">{parseFloat(info.balance.usdt).toFixed(2)} USDT</span>
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
  if (status === "checking") return <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />;
  if (status === "passed") return <span className="text-green-600 text-sm">&#10003;</span>;
  if (status === "blocked") return <span className="text-red-500 text-sm">&#10007;</span>;
  return <div className="h-3 w-3 rounded-full bg-stone-300" />;
}

function SpendingBar({ agent, data }: { agent: string; data: SpendingAgent }) {
  const pct = Math.min(data.percent, 100);
  const barColor = pct > 90 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-stone-500">Agent {agent}</span>
        <span className="font-mono text-stone-700">{data.spent.toFixed(4)} / {data.cap} KITE</span>
      </div>
      <div className="h-2 w-full rounded-full bg-stone-200">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-stone-400">
        <span>{pct.toFixed(1)}% used</span>
        <span>{data.remaining.toFixed(4)} remaining</span>
      </div>
    </div>
  );
}

function SecurityPanel({ events, transactions }: {
  events: SecurityEvent[];
  transactions?: QueryResult["transactions"];
}) {
  if (events.length === 0) return null;

  const latestByPhase: Record<string, SecurityEvent> = {};
  for (const e of events) {
    latestByPhase[e.phase] = e;
  }

  const latestEvent = events[events.length - 1];
  const spending = latestEvent.spending;

  return (
    <div className="mb-4 rounded-lg border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">x402 Security</span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <SpendingBar agent="A" data={spending.A} />
        <SpendingBar agent="B" data={spending.B} />
        <SpendingBar agent="C" data={spending.C} />
      </div>

      <div className="flex items-center gap-1">
        {PHASE_ORDER.map((phase, i) => {
          const ev = latestByPhase[phase];
          const status = ev?.status || "pending";
          const bgClass =
            status === "passed" ? "border-green-300 bg-green-50" :
            status === "blocked" ? "border-red-300 bg-red-50" :
            status === "checking" ? "border-amber-300 bg-amber-50" :
            "border-stone-200 bg-stone-50";

          return (
            <div key={phase} className="flex items-center gap-1">
              {i > 0 && (
                <div className={`h-px w-4 ${status === "passed" ? "bg-green-400" : status === "blocked" ? "bg-red-400" : "bg-stone-300"}`} />
              )}
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${bgClass}`}>
                <StatusIcon status={status} />
                <div>
                  <div className="text-xs font-medium text-stone-800">{PHASE_LABELS[phase]}</div>
                  {ev && (
                    <div className="text-[10px] text-stone-500">{ev.message}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {latestByPhase.balance_check?.balances && latestByPhase.balance_check.status === "passed" && (
        <div className="mt-3 grid grid-cols-3 gap-4 text-xs text-stone-500">
          <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
            <span>Agent A on-chain</span>
            <span className="font-mono text-stone-800">{parseFloat(latestByPhase.balance_check.balances.A.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
            <span>Agent B on-chain</span>
            <span className="font-mono text-stone-800">{parseFloat(latestByPhase.balance_check.balances.B.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
            <span>Agent C on-chain</span>
            <span className="font-mono text-stone-800">{parseFloat(latestByPhase.balance_check.balances.C.kite).toFixed(4)} KITE</span>
          </div>
        </div>
      )}

      {latestByPhase.escrow?.escrows && latestByPhase.escrow.status === "passed" && (
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs text-stone-500">
          {latestByPhase.escrow.escrows.A.transactionHash && (
            <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
              <span>Agent A escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.A.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 underline">
                {latestByPhase.escrow.escrows.A.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.B.transactionHash && (
            <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
              <span>Agent B escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.B.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 underline">
                {latestByPhase.escrow.escrows.B.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.C.transactionHash && (
            <div className="flex justify-between rounded bg-stone-50 px-2 py-1">
              <span>Agent C escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.C.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 underline">
                {latestByPhase.escrow.escrows.C.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
        </div>
      )}

      {transactions && (
        <>
          <hr className="my-4 border-stone-200" />
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Kite Transactions</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-stone-600">Agent A Escrow</span>
              <TxLink hash={transactions.escrowA.transactionHash} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-600">Agent B Escrow</span>
              <TxLink hash={transactions.escrowB.transactionHash} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-600">Agent C Escrow</span>
              <TxLink hash={transactions.escrowC.transactionHash} />
            </div>
            {transactions.reward && (
              <>
                <hr className="border-stone-200" />
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">Winner Reward ({transactions.reward.winnerAmount} KITE)</span>
                  <TxLink hash={transactions.reward.winnerTx.transactionHash} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">Verifier Cut ({transactions.reward.verifierCut} KITE)</span>
                  <span className="text-xs text-stone-400">retained</span>
                </div>
              </>
            )}
          </div>
        </>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
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

function DragHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
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
      <div className="h-8 w-1 rounded-full bg-stone-300 transition-colors group-hover:bg-stone-500" />
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
  const [overlay, setOverlay] = useState<"security" | null>(null);

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

  const winner = result?.verification.claims.winner;
  const hasActivity = !!(submittedQuery || loading || result || error);

  return (
    <div className="flex h-screen flex-col bg-[#FAFAF5] font-sans">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
          {!hasActivity && (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
              <h1 className="mb-1 text-3xl font-bold tracking-tight text-stone-900">
                Sniper
              </h1>
              <p className="mb-8 text-stone-500">
                Multi-model AI orchestrator with VeriScore verification and Kite escrow
              </p>
              <WalletPanel wallets={wallets} />
            </div>
          )}

          {submittedQuery && (
            <div className="mb-4 flex justify-end">
              <div className="max-w-[70%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-3 text-sm text-white">
                {submittedQuery}
              </div>
            </div>
          )}

          {(loading || (!result && (securityEvents.length > 0 || steps.length > 0 || error))) && (
            <div className="mb-4">
              {securityEvents.length > 0 && (
                <SecurityPanel events={securityEvents} />
              )}

              {(loading || steps.length > 0) && (
                <div className="mb-4 rounded-lg border border-stone-200 bg-white p-4 font-mono text-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">Live</span>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {steps.map((step, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="shrink-0 text-stone-400">[{i + 1}]</span>
                        <span className={
                          step.includes("failed") || step.includes("error")
                            ? "text-red-600"
                            : step.includes("escrowed") || step.includes("rewarded") || step.includes("Winner")
                              ? "text-green-600"
                              : step.includes("VeriScore") || step.includes("Precision")
                                ? "text-amber-600"
                                : "text-stone-700"
                        }>
                          {step}
                        </span>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex items-center gap-2 text-xs text-stone-400">
                        <div className="h-3 w-3 animate-spin rounded-full border border-stone-300 border-t-stone-600" />
                        <span>Processing...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="w-full px-4 pb-6">
            {error && (
              <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                {error}
              </div>
            )}

            <div className="flex">
              {/* Left sidebar */}
              <div className="hidden shrink-0 xl:block overflow-y-auto pr-1" style={{ width: leftWidth }}>
                <div className="sticky top-6 space-y-4">
                  {securityEvents.length > 0 && (
                    <div
                      className="cursor-pointer rounded-lg ring-stone-300 transition-all hover:ring-2"
                      onClick={() => setOverlay("security")}
                      title="Click to expand"
                    >
                      <SecurityPanel events={securityEvents} transactions={result.transactions} />
                    </div>
                  )}

                  <ScoreCard label="Agent A — OpenAI" score={result.verification.scores.agentA} isWinner={winner === "A"} />
                  <ScoreCard label="Agent B — Gemini" score={result.verification.scores.agentB} isWinner={winner === "B"} />
                  <ScoreCard label="Agent C — Claude" score={result.verification.scores.agentC} isWinner={winner === "C"} />
                </div>
              </div>

              <div className="hidden xl:flex">
                <DragHandle onDrag={handleDrag} />
              </div>

              {/* Right — main content */}
              <div className="min-w-0 flex-1 space-y-5 pl-1">
                {/* Score cards for mobile */}
                <div className="grid grid-cols-3 gap-4 xl:hidden">
                  <ScoreCard label="Agent A — OpenAI" score={result.verification.scores.agentA} isWinner={winner === "A"} />
                  <ScoreCard label="Agent B — Gemini" score={result.verification.scores.agentB} isWinner={winner === "B"} />
                  <ScoreCard label="Agent C — Claude" score={result.verification.scores.agentC} isWinner={winner === "C"} />
                </div>

                {/* Winner */}
                <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
                  <span className="text-lg font-bold text-amber-800">
                    Winner: Agent {winner} ({winner ? AGENT_NAMES[winner] : "?"})
                  </span>
                  <div className="mt-2 flex gap-4 text-sm text-amber-700">
                    <span>A: {Math.round(result.verification.scores.agentA.precision * 100)}%</span>
                    <span>B: {Math.round(result.verification.scores.agentB.precision * 100)}%</span>
                    <span>C: {Math.round(result.verification.scores.agentC.precision * 100)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-amber-600">
                    Winner determined by highest VeriScore precision (web-verified claim accuracy)
                  </p>
                </div>

                {/* Agent Responses */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {/* Agent A */}
                  <div className={`rounded-lg border ${winner === "A" ? "border-amber-500" : "border-stone-200"} bg-white`}>
                    <div className="border-b border-stone-200 px-4 py-3">
                      <h3 className="font-semibold text-stone-800">Agent A — {result.individualResponses.openai.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                          {agentAClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          {agentAClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.openai.error ? (
                        <p className="text-red-500">{result.individualResponses.openai.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.openai.content} />
                      )}
                      <ClaimsList claims={agentAClaims} />
                    </div>
                  </div>

                  {/* Agent B */}
                  <div className={`rounded-lg border ${winner === "B" ? "border-amber-500" : "border-stone-200"} bg-white`}>
                    <div className="border-b border-stone-200 px-4 py-3">
                      <h3 className="font-semibold text-stone-800">Agent B — {result.individualResponses.gemini.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                          {agentBClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          {agentBClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.gemini.error ? (
                        <p className="text-red-500">{result.individualResponses.gemini.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.gemini.content} />
                      )}
                      <ClaimsList claims={agentBClaims} />
                    </div>
                  </div>

                  {/* Agent C */}
                  <div className={`rounded-lg border ${winner === "C" ? "border-amber-500" : "border-stone-200"} bg-white`}>
                    <div className="border-b border-stone-200 px-4 py-3">
                      <h3 className="font-semibold text-stone-800">Agent C — {result.individualResponses.claude.model}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                          {agentCClaims.filter((c) => c.status === "supported").length} supported
                        </span>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          {agentCClaims.filter((c) => c.status === "inconclusive").length} inconclusive
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      {result.individualResponses.claude.error ? (
                        <p className="text-red-500">{result.individualResponses.claude.error}</p>
                      ) : (
                        <StreamingResponse content={result.individualResponses.claude.content} />
                      )}
                      <ClaimsList claims={agentCClaims} />
                    </div>
                  </div>
                </div>

                {/* x402 Security & Kite Transactions — mobile */}
                {securityEvents.length > 0 && (
                  <div
                    className="cursor-pointer rounded-lg ring-stone-300 transition-all hover:ring-2 xl:hidden"
                    onClick={() => setOverlay("security")}
                    title="Click to expand"
                  >
                    <SecurityPanel events={securityEvents} transactions={result.transactions} />
                  </div>
                )}
              </div>
            </div>

            {overlay === "security" && securityEvents.length > 0 && (
              <Overlay onClose={() => setOverlay(null)} wide>
                <SecurityPanel events={securityEvents} transactions={result.transactions} />
              </Overlay>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-stone-200 bg-[#FAFAF5] px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-4xl gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything..."
            className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-stone-900 placeholder-stone-400 focus:border-stone-500 focus:outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-xl bg-stone-900 px-6 py-3 font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? "Processing..." : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}
