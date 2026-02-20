"use client";

import { useState, useEffect, useCallback } from "react";

interface ClaimClassification {
  claim: string;
  originalText: string;
  source: "A" | "B";
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
      novelInsights: { agent: "A" | "B"; insight: string }[];
      bestNovelInsight: { agent: "A" | "B"; insight: string; reasoning: string };
      winner: "A" | "B";
    };
    scores: {
      K: number;
      agentA: AgentScore;
      agentB: AgentScore;
    };
  };
  transactions: {
    stakeA: { success: boolean; transactionHash?: string; error?: string };
    stakeB: { success: boolean; transactionHash?: string; error?: string };
    reward: {
      winnerTx: { success: boolean; transactionHash?: string; error?: string };
      verifierCut: string;
      winnerAmount: string;
    } | null;
  };
  individualResponses: {
    openai: { model: string; content: string; error?: string };
    gemini: { model: string; content: string; error?: string };
  };
}

const EXPLORER = "https://testnet.kitescan.ai";

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

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    supported: "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
    contradicted: "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200",
    inconclusive: "bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200",
    novel: "bg-green-300 text-green-900 dark:bg-green-700 dark:text-green-100",
  };
  return colors[status] || "";
}

function HighlightedResponse({
  content,
  claims,
}: {
  content: string;
  claims: ClaimClassification[];
}) {
  if (!claims.length) {
    return <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{content}</p>;
  }

  // Build segments: for each claim, find its originalText in the content and wrap it
  const segments: { text: string; status?: string }[] = [];
  let remaining = content;

  // Sort claims by their position in the text
  const sortedClaims = [...claims].sort((a, b) => {
    const posA = content.indexOf(a.originalText);
    const posB = content.indexOf(b.originalText);
    return posA - posB;
  });

  for (const claim of sortedClaims) {
    const idx = remaining.indexOf(claim.originalText);
    if (idx === -1) continue;

    if (idx > 0) {
      segments.push({ text: remaining.slice(0, idx) });
    }
    segments.push({ text: claim.originalText, status: claim.status });
    remaining = remaining.slice(idx + claim.originalText.length);
  }

  if (remaining) {
    segments.push({ text: remaining });
  }

  // If no segments matched, just show raw text
  if (segments.length === 0) {
    return <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{content}</p>;
  }

  return (
    <div className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.status ? (
          <span key={i} className={`inline rounded px-1 py-0.5 ${statusColor(seg.status)}`}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
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
    { key: "verifier", label: "Verifier (Claude)" },
  ];

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [wallets, setWallets] = useState<Record<string, WalletInfo | { error: string }> | null>(null);

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch("/api/wallets");
      if (res.ok) setWallets(await res.json());
    } catch {
      // silently fail — wallets panel just won't show
    }
  }, []);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);
    setSteps([]);

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

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-12 font-sans dark:bg-black">
      <div className="w-full max-w-4xl">
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sniper
        </h1>
        <p className="mb-6 text-zinc-500 dark:text-zinc-400">
          Multi-model AI orchestrator with VeriScore verification and Kite staking
        </p>

        <WalletPanel wallets={wallets} />

        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything..."
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {loading ? "Processing..." : "Ask"}
            </button>
          </div>
        </form>

        {(loading || (steps.length > 0 && !result)) && (
          <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-900 p-4 font-mono text-sm dark:border-zinc-700">
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
                      : step.includes("staked") || step.includes("rewarded") || step.includes("Winner")
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
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-6">
            {/* VeriScore Cards */}
            <div className="grid grid-cols-2 gap-4">
              <ScoreCard label="Agent A — OpenAI (VeriScore)" score={result.verification.scores.agentA} />
              <ScoreCard label="Agent B — Gemini (VeriScore)" score={result.verification.scores.agentB} />
            </div>

            {/* Winner */}
            <div className="rounded-lg border-2 border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-green-700 dark:text-green-400">
                  Winner: Agent {result.verification.claims.winner} ({result.verification.claims.winner === "A" ? "OpenAI" : "Gemini"})
                </span>
              </div>
              <p className="mt-2 text-sm text-green-800 dark:text-green-300">
                <strong>Best novel insight:</strong> {result.verification.claims.bestNovelInsight.insight}
              </p>
              <p className="mt-1 text-xs text-green-600 dark:text-green-500">
                {result.verification.claims.bestNovelInsight.reasoning}
              </p>
            </div>

            {/* Agent Responses with Highlighted Claims */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Agent A */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Agent A — {result.individualResponses.openai.model}</h3>
                  <div className="mt-1 flex gap-2 text-xs">
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
                    <HighlightedResponse
                      content={result.individualResponses.openai.content}
                      claims={agentAClaims}
                    />
                  )}
                </div>
              </div>

              {/* Agent B */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Agent B — {result.individualResponses.gemini.model}</h3>
                  <div className="mt-1 flex gap-2 text-xs">
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
                    <HighlightedResponse
                      content={result.individualResponses.gemini.content}
                      claims={agentBClaims}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Combined Analysis */}
            <div className="space-y-4">
              {/* Consensus */}
              {result.verification.claims.consensusInsights.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Consensus Insights (Both Agents Agree)
                  </h3>
                  <ul className="space-y-1">
                    {result.verification.claims.consensusInsights.map((insight, i) => (
                      <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Novel Insights */}
              {result.verification.claims.novelInsights.length > 0 && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Novel Insights
                  </h3>
                  <ul className="space-y-2">
                    {result.verification.claims.novelInsights.map((n, i) => (
                      <li
                        key={i}
                        className="rounded border-l-4 border-green-500 bg-green-50 p-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
                      >
                        <span className="mr-2 rounded bg-green-200 px-1.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-800 dark:text-green-200">
                          Agent {n.agent}
                        </span>
                        {n.insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Transactions */}
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Kite Transactions
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Agent A Stake</span>
                  <TxLink hash={result.transactions.stakeA.transactionHash} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Agent B Stake</span>
                  <TxLink hash={result.transactions.stakeB.transactionHash} />
                </div>
                {result.transactions.reward && (
                  <>
                    <hr className="border-zinc-200 dark:border-zinc-700" />
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Winner Reward ({result.transactions.reward.winnerAmount} KITE)
                      </span>
                      <TxLink hash={result.transactions.reward.winnerTx.transactionHash} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Verifier Cut ({result.transactions.reward.verifierCut} KITE)
                      </span>
                      <span className="text-xs text-zinc-400">retained</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
