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

// --- UI helpers ---

function statusColor(status: string) {
  switch (status) {
    case "supported":
      return "bg-green-900/30 text-green-300";
    case "inconclusive":
      return "bg-amber-900/30 text-amber-300";
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
    <div className="text-[#ECECEC] whitespace-pre-wrap">
      {visText}
      {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[#C47B4A] align-text-bottom" />}
    </div>
  );
}

function ScoreCard({ label, score, isWinner }: { label: string; score: AgentScore; isWinner: boolean }) {
  const pct = Math.round(score.precision * 100);
  return (
    <div className={`rounded-lg border p-4 ${isWinner ? "border-[#C47B4A] bg-[#3A3A3A]" : "border-[#444444] bg-[#353535]"}`}>
      <h3 className="mb-2 text-sm font-semibold text-[#888888]">{label}</h3>
      <div className={`mb-3 text-3xl font-bold ${isWinner ? "text-[#C47B4A]" : "text-[#ECECEC]"}`}>
        {pct}%
        {isWinner && <span className="ml-2 text-xs font-semibold text-[#C47B4A] uppercase">Prize Recipient</span>}
      </div>
      <div className="space-y-1.5 text-xs text-[#888888]">
        <div className="flex justify-between">
          <span>Total claims</span>
          <span className="font-mono text-[#ECECEC]">{score.total}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-400">Verified</span>
          <span className="font-mono text-green-400">{score.supported}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#C47B4A]">Unverified</span>
          <span className="font-mono text-[#C47B4A]">{score.inconclusive}</span>
        </div>
        <hr className="border-[#444444]" />
        <div className="flex justify-between font-medium">
          <span className="text-[#ECECEC]">Precision</span>
          <span className="font-mono text-[#ECECEC]">{(score.precision * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// --- Reference Links ---

function RefLinks({ urls }: { urls: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (urls.length === 0) return null;
  const show = expanded ? urls : urls.slice(0, 3);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {show.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors"
          title={url}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          {domainFromUrl(url)}
        </a>
      ))}
      {urls.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400/70 hover:bg-blue-500/20"
        >
          {expanded ? "show less" : `+${urls.length - 3} more`}
        </button>
      )}
    </div>
  );
}

// --- Novel Claims Panel (the USP) ---

interface NovelClaim {
  claim: string;
  urls: string[];
  llm: string;
  status: "supported" | "inconclusive" | "contradicted";
}

const AGENT_LLM_LABELS: Record<string, string> = {
  claude: "Claude", gemini: "Gemini", "gpt-4": "GPT-4", gpt: "GPT-4",
};

function NovelClaimsPanel({ classifierResult }: {
  classifierResult?: ClassifierResult | null;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!classifierResult) return null;

  const novel: NovelClaim[] = [];

  for (const [llm, data] of Object.entries(classifierResult.minorityClaims || {})) {
    for (const status of ["supported", "inconclusive", "contradicted"] as const) {
      for (const entry of data[status] || []) {
        if (!isMetaClaim(entry[0])) {
          novel.push({ claim: entry[0], urls: (entry[1] || []) as string[], llm, status });
        }
      }
    }
  }

  const statusOrder = { supported: 0, inconclusive: 1, contradicted: 2 };
  novel.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.urls.length - a.urls.length);

  const supportedCount = novel.filter((c) => c.status === "supported").length;
  const visible = showAll ? novel : novel.slice(0, 8);

  if (novel.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-blue-500/50 bg-[#1A2332] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-white text-xs font-bold">
            {supportedCount}
          </div>
          <div>
            <h3 className="text-sm font-bold text-blue-100">Novel / Minority Claims</h3>
            <p className="text-[11px] text-blue-300/70">
              Unique facts surfaced by a single LLM — {supportedCount} verified, {novel.length} total
            </p>
          </div>
        </div>
        {novel.length > 8 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="rounded-md bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300 hover:bg-blue-500/30 transition-colors"
          >
            {showAll ? "Show less" : `Show all ${novel.length}`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visible.map((c, i) => (
          <div
            key={i}
            className={`rounded-lg border px-3 py-2 ${
              c.status === "supported"
                ? "border-green-500/40 bg-[#1E2D1E]"
                : c.status === "contradicted"
                  ? "border-red-500/40 bg-[#2D1E1E]"
                  : "border-blue-500/20 bg-[#1A2332]/70"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase leading-tight ${
                  c.status === "supported"
                    ? "bg-green-600 text-white"
                    : c.status === "contradicted"
                      ? "bg-red-500 text-white"
                      : "bg-blue-500 text-white"
                }`}
              >
                {c.status === "supported" ? "verified" : c.status}
              </span>
              <span
                className="shrink-0 mt-0.5 rounded bg-blue-600 px-1 py-0.5 text-[10px] font-bold text-white uppercase leading-tight"
              >
                {AGENT_LLM_LABELS[c.llm] || c.llm}
              </span>
              <p className="text-xs text-blue-50 leading-relaxed">{c.claim}</p>
            </div>
            {c.urls.length > 0 && <RefLinks urls={c.urls} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Per-Agent Claims List ---

function ClaimsList({ claims, classifierResult, model }: {
  claims: ClaimClassification[];
  classifierResult?: ClassifierResult | null;
  model?: string;
}) {
  const [expandedClaim, setExpandedClaim] = useState<number | null>(null);
  const filtered = claims.filter((c) => !isMetaClaim(c.claim));
  if (filtered.length === 0) return null;

  const minorityClaims = filtered.filter(
    (c) => getClaimCategory(c.claim, model, classifierResult) === "minority"
  );
  const majorityClaims = filtered.filter(
    (c) => getClaimCategory(c.claim, model, classifierResult) !== "minority"
  );

  const renderClaim = (c: ClaimClassification, i: number, isMinority: boolean) => {
    const refs = getClaimRefs(c.claim, model, classifierResult);
    const isExpanded = expandedClaim === i;
    return (
      <div
        key={i}
        className={`rounded-md px-2.5 py-2 text-xs transition-all ${
          isMinority
            ? c.status === "supported"
              ? "border-l-2 border-l-blue-400 bg-[#1A2332]"
              : "border-l-2 border-l-blue-500/50 bg-[#1A2332]/50"
            : statusColor(c.status)
        } ${refs.length > 0 ? "cursor-pointer" : ""}`}
        onClick={() => refs.length > 0 && setExpandedClaim(isExpanded ? null : i)}
      >
        <div className="flex items-start gap-1">
          <div className="flex shrink-0 gap-1 mt-0.5">
            <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-bold uppercase leading-tight ${
              c.status === "supported" ? "bg-green-600 text-white" : "bg-amber-500 text-white"
            }`}>
              {c.status === "supported" ? "verified" : c.status}
            </span>
            {isMinority && (
              <span className="inline-block rounded bg-blue-500 px-1 py-0.5 text-[10px] font-bold uppercase text-white leading-tight">
                novel
              </span>
            )}
          </div>
          <span className="leading-relaxed">{c.claim}</span>
          {refs.length > 0 && (
            <span className="ml-auto shrink-0 text-[10px] text-blue-400 font-medium">
              {refs.length} refs {isExpanded ? "\u25B2" : "\u25BC"}
            </span>
          )}
        </div>
        {isExpanded && <RefLinks urls={refs} />}
      </div>
    );
  };

  return (
    <div className="mt-3 space-y-2 border-t border-[#444444] pt-3">
      {minorityClaims.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-400 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Novel Claims
          </h4>
          <div className="space-y-1.5">
            {minorityClaims.map((c, i) => renderClaim(c, i, true))}
          </div>
        </div>
      )}
      {majorityClaims.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#888888]">
            Consensus Claims
          </h4>
          <div className="space-y-1">
            {majorityClaims.map((c, i) => renderClaim(c, i + minorityClaims.length, false))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Annotated Response (inline classifier badges) ---

function badgeClass(category: string, status: string): string {
  if (category === "majority" && status === "supported") return "bg-green-600 text-white";
  if (category === "majority" && status === "inconclusive") return "bg-[#D4A574] text-white";
  if (category === "majority" && status === "contradicted") return "bg-red-500 text-white";
  if (category === "minority" && status === "supported") return "bg-blue-500 text-white";
  if (category === "minority" && status === "inconclusive") return "bg-blue-600/70 text-white";
  if (category === "minority" && status === "contradicted") return "bg-red-400 text-white";
  return "bg-[#444444] text-[#ECECEC]";
}

function AnnotatedResponse({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const tagRegex = /\[(majority|minority),(supported|inconclusive|contradicted),(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`}>{stripMarkdown(text.slice(lastIndex, match.index))}</span>
      );
    }
    const [, category, status] = match;
    parts.push(
      <span
        key={`b-${match.index}`}
        className={`ml-0.5 mr-0.5 inline-block rounded px-1 py-0.5 text-[10px] font-bold uppercase leading-tight ${badgeClass(category, status)}`}
      >
        {category === "majority" ? "MAJ" : "MIN"}/{status.slice(0, 3)}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{stripMarkdown(text.slice(lastIndex))}</span>);
  }

  return <div className="text-[#B0B0B0] whitespace-pre-wrap text-sm leading-relaxed">{parts}</div>;
}

// --- Quick Notes Panel ---

function QuickNotesPanel({ notes }: { notes: ClassifierQuickNotes }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[#444444] bg-[#353535] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#C47B4A]">
          Cross-LLM Analysis
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[#C47B4A] hover:text-[#E8C0A0]"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <p className="text-sm text-[#ECECEC]">{notes.overall_summary}</p>

      {Object.keys(notes.precision_ranking).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(notes.precision_ranking).map(([llm, rank]) => (
            <span key={llm} className="rounded bg-[#444444]/60 px-2 py-1 text-xs text-[#ECECEC]">
              <span className="font-semibold">{llm}:</span> {rank}
            </span>
          ))}
        </div>
      )}

      {notes.red_flags.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-semibold text-red-400">Red Flags</h5>
          <ul className="mt-1 space-y-0.5">
            {notes.red_flags.map((flag, i) => (
              <li key={i} className="text-xs text-red-300">- {flag}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && (
        <>
          {notes.majority_fact_observations.length > 0 && (
            <div className="mt-3">
              <h5 className="text-xs font-semibold text-green-400">Majority Fact Observations</h5>
              <ul className="mt-1 space-y-0.5">
                {notes.majority_fact_observations.map((obs, i) => (
                  <li key={i} className="text-xs text-[#B0B0B0]">- {obs}</li>
                ))}
              </ul>
            </div>
          )}

          {notes.minority_fact_observations.length > 0 && (
            <div className="mt-3">
              <h5 className="text-xs font-semibold text-blue-400">Minority Fact Observations</h5>
              <ul className="mt-1 space-y-0.5">
                {notes.minority_fact_observations.map((obs, i) => (
                  <li key={i} className="text-xs text-[#B0B0B0]">- {obs}</li>
                ))}
              </ul>
            </div>
          )}

          {notes.majority_clusters.length > 0 && (
            <div className="mt-3">
              <h5 className="text-xs font-semibold text-[#C47B4A]">Consensus Clusters</h5>
              <ul className="mt-1 space-y-1">
                {notes.majority_clusters.map((cluster, i) => (
                  <li key={i} className="rounded bg-[#444444]/60 px-2 py-1 text-xs text-[#B0B0B0]">
                    <span className="font-medium">{cluster.theme}</span>
                    <span className="ml-2 text-[#888888]">
                      ({cluster.members.map((m) => m.llm).join(", ")})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Infrastructure components ---

function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="text-[#888888]">-</span>;
  return (
    <a
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-[#C47B4A] underline"
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
            <div key={key} className="rounded-lg border border-[#444444] bg-[#353535] p-3">
              <h3 className="text-xs font-semibold text-[#888888]">{label}</h3>
              <p className="mt-1 text-xs text-red-500">{(data as { error: string })?.error || "Not configured"}</p>
            </div>
          );
        }
        const info = data as WalletInfo;
        return (
          <div key={key} className="rounded-lg border border-[#444444] bg-[#353535] p-3">
            <h3 className="text-xs font-semibold text-[#888888]">{label}</h3>
            <p className="mt-1 font-mono text-xs text-[#B0B0B0] truncate" title={info.aaWallet}>
              {info.aaWallet}
            </p>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="text-[#888888]">{parseFloat(info.balance.kite).toFixed(4)} KITE</span>
              <span className="text-emerald-400">{parseFloat(info.balance.usdt).toFixed(2)} USDT</span>
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
  if (status === "checking") return <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#C47B4A] border-t-transparent" />;
  if (status === "passed") return <span className="text-green-400 text-sm">&#10003;</span>;
  if (status === "blocked") return <span className="text-red-500 text-sm">&#10007;</span>;
  return <div className="h-3 w-3 rounded-full bg-[#444444]" />;
}

function SpendingBar({ agent, data }: { agent: string; data: SpendingAgent }) {
  const pct = Math.min(data.percent, 100);
  const barColor = pct > 90 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#888888]">Agent {agent}</span>
        <span className="font-mono text-[#ECECEC]">{data.spent.toFixed(4)} / {data.cap} KITE</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#444444]">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-[#888888]">
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
    <div className="mb-4 rounded-lg border border-[#444444] bg-[#353535] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#888888]">x402 Security</span>
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
            status === "passed" ? "border-green-500/40 bg-green-900/20" :
            status === "blocked" ? "border-red-500/40 bg-red-900/20" :
            status === "checking" ? "border-[#D4A574] bg-[#3A3A3A]" :
            "border-[#444444] bg-[#2B2B2B]";

          return (
            <div key={phase} className="flex items-center gap-1">
              {i > 0 && (
                <div className={`h-px w-4 ${status === "passed" ? "bg-green-400" : status === "blocked" ? "bg-red-400" : "bg-[#444444]"}`} />
              )}
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${bgClass}`}>
                <StatusIcon status={status} />
                <div>
                  <div className="text-xs font-medium text-[#ECECEC]">{PHASE_LABELS[phase]}</div>
                  {ev && (
                    <div className="text-[10px] text-[#888888]">{ev.message}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {latestByPhase.balance_check?.balances && latestByPhase.balance_check.status === "passed" && (
        <div className="mt-3 grid grid-cols-3 gap-4 text-xs text-[#888888]">
          <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
            <span>Agent A on-chain</span>
            <span className="font-mono text-[#ECECEC]">{parseFloat(latestByPhase.balance_check.balances.A.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
            <span>Agent B on-chain</span>
            <span className="font-mono text-[#ECECEC]">{parseFloat(latestByPhase.balance_check.balances.B.kite).toFixed(4)} KITE</span>
          </div>
          <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
            <span>Agent C on-chain</span>
            <span className="font-mono text-[#ECECEC]">{parseFloat(latestByPhase.balance_check.balances.C.kite).toFixed(4)} KITE</span>
          </div>
        </div>
      )}

      {latestByPhase.escrow?.escrows && latestByPhase.escrow.status === "passed" && (
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs text-[#888888]">
          {latestByPhase.escrow.escrows.A.transactionHash && (
            <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
              <span>Agent A escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.A.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#C47B4A] underline">
                {latestByPhase.escrow.escrows.A.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.B.transactionHash && (
            <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
              <span>Agent B escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.B.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#C47B4A] underline">
                {latestByPhase.escrow.escrows.B.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
          {latestByPhase.escrow.escrows.C.transactionHash && (
            <div className="flex justify-between rounded bg-[#2B2B2B] px-2 py-1">
              <span>Agent C escrow tx</span>
              <a href={`${EXPLORER}/tx/${latestByPhase.escrow.escrows.C.transactionHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#C47B4A] underline">
                {latestByPhase.escrow.escrows.C.transactionHash.slice(0, 10)}...
              </a>
            </div>
          )}
        </div>
      )}

      {transactions && (
        <>
          <hr className="my-4 border-[#444444]" />
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#888888]">Kite Transactions</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#B0B0B0]">Agent A Escrow</span>
              <TxLink hash={transactions.escrowA.transactionHash} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#B0B0B0]">Agent B Escrow</span>
              <TxLink hash={transactions.escrowB.transactionHash} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#B0B0B0]">Agent C Escrow</span>
              <TxLink hash={transactions.escrowC.transactionHash} />
            </div>
            {transactions.reward && (
              <>
                <hr className="border-[#444444]" />
                <div className="flex items-center justify-between">
                  <span className="text-[#B0B0B0]">Winner Reward ({transactions.reward.winnerAmount} KITE)</span>
                  <TxLink hash={transactions.reward.winnerTx.transactionHash} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#B0B0B0]">Verifier Cut ({transactions.reward.verifierCut} KITE)</span>
                  <span className="text-xs text-[#888888]">retained</span>
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
      <div className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-[#444444] bg-[#353535] p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-[#888888] transition-colors hover:bg-[#444444] hover:text-[#ECECEC]"
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
      <div className="h-8 w-1 rounded-full bg-[#444444] transition-colors group-hover:bg-[#C47B4A]" />
    </div>
  );
}

// --- Main Page ---

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
    <div className="flex h-screen flex-col bg-[#2B2B2B] font-sans">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-6">
          {!hasActivity && (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
              <h1 className="mb-1 text-3xl font-bold tracking-tight text-[#ECECEC]">
                Sniper
              </h1>
              <p className="mb-8 text-[#888888]">
                Multi-model AI orchestrator with VeriScore verification and Kite escrow
              </p>
              <WalletPanel wallets={wallets} />
            </div>
          )}

          {submittedQuery && (
            <div className="mb-4 flex justify-end">
              <div className="max-w-[70%] rounded-2xl rounded-br-md bg-[#D4A574] px-4 py-3 text-sm text-white">
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
                <div className="mb-4 rounded-lg border border-[#444444] bg-[#353535] p-4 font-mono text-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-[#C47B4A]" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#C47B4A]">Live</span>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {steps.map((step, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="shrink-0 text-[#888888]">[{i + 1}]</span>
                        <span className={
                          step.includes("failed") || step.includes("error")
                            ? "text-red-400"
                            : step.includes("escrowed") || step.includes("rewarded") || step.includes("Winner")
                              ? "text-green-400"
                              : step.includes("VeriScore") || step.includes("Precision")
                                ? "text-amber-400"
                                : step.includes("classifier")
                                  ? "text-indigo-400"
                                  : "text-[#ECECEC]"
                        }>
                          {step}
                        </span>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex items-center gap-2 text-xs text-[#888888]">
                        <div className="h-3 w-3 animate-spin rounded-full border border-[#444444] border-t-[#C47B4A]" />
                        <span>Processing...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 p-4 text-red-300">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="w-full px-4 pb-6">
            {error && (
              <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-red-500/30 bg-red-900/20 p-4 text-red-300">
                {error}
              </div>
            )}

            <div className="flex">
              {/* Left sidebar — security + scores */}
              <div className="hidden shrink-0 xl:block overflow-y-auto pr-1" style={{ width: leftWidth }}>
                <div className="sticky top-6 space-y-4">
                  {securityEvents.length > 0 && (
                    <div
                      className="cursor-pointer rounded-lg ring-[#444444] transition-all hover:ring-2"
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

              {/* Center — main content */}
              <div className="min-w-0 flex-1 space-y-5 pl-1">
                {/* Score cards for mobile */}
                <div className="grid grid-cols-3 gap-4 xl:hidden">
                  <ScoreCard label="Agent A — OpenAI" score={result.verification.scores.agentA} isWinner={winner === "A"} />
                  <ScoreCard label="Agent B — Gemini" score={result.verification.scores.agentB} isWinner={winner === "B"} />
                  <ScoreCard label="Agent C — Claude" score={result.verification.scores.agentC} isWinner={winner === "C"} />
                </div>

                {/* Prize Pool Recipient */}
                <div className="rounded-lg border-2 border-[#C47B4A] bg-[#3A3A3A] p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-[#ECECEC]">
                      {winner ? AGENT_NAMES[winner] : "?"} awarded the prize pool
                    </span>
                    <span className="rounded-full bg-[#D4A574] px-2.5 py-0.5 text-xs font-semibold text-white">
                      Agent {winner}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-[#B0B0B0]">
                    Produced the highest proportion of web-verified claims at{" "}
                    <span className="font-semibold text-[#C47B4A]">
                      {winner === "A" ? Math.round(result.verification.scores.agentA.precision * 100) :
                       winner === "B" ? Math.round(result.verification.scores.agentB.precision * 100) :
                       Math.round(result.verification.scores.agentC.precision * 100)}% precision
                    </span>
                    , including novel claims not found in competing responses.
                  </p>
                  <div className="mt-2 flex gap-4 text-xs text-[#888888]">
                    <span>OpenAI: {Math.round(result.verification.scores.agentA.precision * 100)}%</span>
                    <span>Gemini: {Math.round(result.verification.scores.agentB.precision * 100)}%</span>
                    <span>Claude: {Math.round(result.verification.scores.agentC.precision * 100)}%</span>
                  </div>
                </div>

                {/* Quick Notes from Classifier */}
                {result.verification.classifierResult?.quickNotes && (
                  <QuickNotesPanel notes={result.verification.classifierResult.quickNotes} />
                )}

                {/* Agent Responses + Novel Claims sidebar */}
                <div className="flex gap-5">
                  {/* Agent Responses */}
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      {/* Agent A */}
                      <div className={`rounded-lg border ${winner === "A" ? "border-[#C47B4A]" : "border-[#444444]"} bg-[#353535]`}>
                        <div className="border-b border-[#444444] px-4 py-3">
                          <h3 className="font-semibold text-[#ECECEC]">Agent A — {result.individualResponses.openai.model}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-green-300">
                              {agentAClaims.filter((c) => c.status === "supported").length} verified
                            </span>
                            <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-300">
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
                          <ClaimsList claims={agentAClaims} classifierResult={result.verification.classifierResult} model="gpt" />
                        </div>
                      </div>

                      {/* Agent B */}
                      <div className={`rounded-lg border ${winner === "B" ? "border-[#C47B4A]" : "border-[#444444]"} bg-[#353535]`}>
                        <div className="border-b border-[#444444] px-4 py-3">
                          <h3 className="font-semibold text-[#ECECEC]">Agent B — {result.individualResponses.gemini.model}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-green-300">
                              {agentBClaims.filter((c) => c.status === "supported").length} verified
                            </span>
                            <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-300">
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
                          <ClaimsList claims={agentBClaims} classifierResult={result.verification.classifierResult} model="gemini" />
                        </div>
                      </div>

                      {/* Agent C */}
                      <div className={`rounded-lg border ${winner === "C" ? "border-[#C47B4A]" : "border-[#444444]"} bg-[#353535]`}>
                        <div className="border-b border-[#444444] px-4 py-3">
                          <h3 className="font-semibold text-[#ECECEC]">Agent C — {result.individualResponses.claude.model}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                            <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-green-300">
                              {agentCClaims.filter((c) => c.status === "supported").length} verified
                            </span>
                            <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-300">
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
                          <ClaimsList claims={agentCClaims} classifierResult={result.verification.classifierResult} model="claude" />
                        </div>
                      </div>
                    </div>

                    {/* x402 Security & Kite Transactions — mobile */}
                    {securityEvents.length > 0 && (
                      <div
                        className="cursor-pointer rounded-lg ring-[#444444] transition-all hover:ring-2 xl:hidden"
                        onClick={() => setOverlay("security")}
                        title="Click to expand"
                      >
                        <SecurityPanel events={securityEvents} transactions={result.transactions} />
                      </div>
                    )}
                  </div>

                  {/* Novel / Minority Claims — right sidebar (the USP) */}
                  <div className="hidden w-[380px] shrink-0 xl:block">
                    <div className="sticky top-6">
                      <NovelClaimsPanel
                        classifierResult={result.verification.classifierResult}
                      />
                    </div>
                  </div>
                </div>

                {/* Novel Claims — mobile (below agent responses) */}
                <div className="xl:hidden">
                  <NovelClaimsPanel
                    classifierResult={result.verification.classifierResult}
                  />
                </div>
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
      <div className="shrink-0 border-t border-[#444444] bg-[#2B2B2B] px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-4xl gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything..."
            className="flex-1 rounded-xl border border-[#444444] bg-[#353535] px-4 py-3 text-[#ECECEC] placeholder-[#888888] focus:border-[#C47B4A] focus:outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-xl bg-[#C47B4A] px-6 py-3 font-medium text-white transition-colors hover:bg-[#E8C0A0] disabled:opacity-50"
          >
            {loading ? "Processing..." : "Ask"}
          </button>
        </form>
      </div>
    </div>
  );
}
