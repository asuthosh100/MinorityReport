import { getBalance } from "@/lib/kite/wallets";
import { ESCROW_AMOUNT } from "@/lib/kite/config";
import type { AgentId } from "@/lib/types";

// --- Rate Limiter (in-memory, resets on cold start) ---

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per window

const requestLog: number[] = [];

export function checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  // Prune old entries
  while (requestLog.length > 0 && requestLog[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestLog.shift();
  }

  if (requestLog.length >= RATE_LIMIT_MAX) {
    const oldestInWindow = requestLog[0];
    const retryAfterMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, retryAfterMs };
  }

  requestLog.push(now);
  return { allowed: true };
}

// --- Spending Cap Tracker ---

const SPENDING_CAP_KITE = 0.01; // max 0.01 KITE total per agent

const spendingTracker: Record<string, number> = {
  A: 0,
  B: 0,
  C: 0,
};

export function checkSpendingCap(agent: AgentId): {
  allowed: boolean;
  spent: number;
  cap: number;
  remaining: number;
} {
  const spent = spendingTracker[agent] || 0;
  const remaining = SPENDING_CAP_KITE - spent;
  const escrowNeeded = parseFloat(ESCROW_AMOUNT);

  return {
    allowed: remaining >= escrowNeeded,
    spent,
    cap: SPENDING_CAP_KITE,
    remaining,
  };
}

export function recordSpending(agent: AgentId, amount: number): void {
  spendingTracker[agent] = (spendingTracker[agent] || 0) + amount;
}

export interface SpendingState {
  agent: AgentId;
  spent: number;
  cap: number;
  remaining: number;
  percent: number;
}

export function getSpendingState(): { A: SpendingState; B: SpendingState; C: SpendingState } {
  function build(agent: AgentId): SpendingState {
    const spent = spendingTracker[agent] || 0;
    const remaining = SPENDING_CAP_KITE - spent;
    const percent = Math.min((spent / SPENDING_CAP_KITE) * 100, 100);
    return { agent, spent, cap: SPENDING_CAP_KITE, remaining, percent };
  }
  return { A: build("A"), B: build("B"), C: build("C") };
}

// --- Pre-flight Balance Check ---

export interface BalanceCheckResult {
  agent: AgentId;
  ok: boolean;
  kite: string;
  usdt: string;
  needed: string;
  error?: string;
}

export async function preflightBalanceCheck(
  agent: AgentId
): Promise<BalanceCheckResult> {
  const needed = ESCROW_AMOUNT;

  try {
    const balance = await getBalance(agent);
    const kiteBalance = parseFloat(balance.kite);
    const neededAmount = parseFloat(needed);

    if (kiteBalance < neededAmount) {
      return {
        agent,
        ok: false,
        kite: balance.kite,
        usdt: balance.usdt,
        needed,
        error: `Insufficient funds: Agent ${agent} has ${balance.kite} KITE but needs ${needed} KITE for escrow`,
      };
    }

    return {
      agent,
      ok: true,
      kite: balance.kite,
      usdt: balance.usdt,
      needed,
    };
  } catch (err) {
    return {
      agent,
      ok: false,
      kite: "0",
      usdt: "0",
      needed,
      error: `Balance check failed for Agent ${agent}: ${err}`,
    };
  }
}
