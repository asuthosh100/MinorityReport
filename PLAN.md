# OpenClaw — Staking + VeriScore-style Verification + Reward System

## Overview

Agent A (OpenAI) and Agent B (Gemini) **stake KITE tokens** before answering a query. A **Claude-based Verifier** runs a **VeriScore-inspired pipeline** — extracting verifiable atomic claims, cross-comparing them across both agents, classifying them (supported/contradicted/inconclusive), separating consensus from novel insights, and computing a VeriScore (F1@K) per agent. The agent with the best novel insight wins the staked pool minus the verifier's cut.

## VeriScore-Inspired Pipeline

Adapted from [VeriScore (EMNLP 2024)](https://github.com/Yixiao-Song/VeriScore). Original VeriScore verifies claims against Google search results. Our adaptation verifies claims **across both agents against each other**, then uses Claude as the judge.

```
┌──────────────────────────────────────────────────────────────────┐
│  VERISCORE-STYLE VERIFICATION (Claude Verifier)                  │
│                                                                  │
│  Stage 1: CLAIM EXTRACTION                                       │
│  ├── Process Agent A response sentence-by-sentence               │
│  ├── Process Agent B response sentence-by-sentence               │
│  ├── Extract ONLY verifiable atomic claims (not opinions/advice)  │
│  ├── Each claim is self-contained (no pronouns, named entities)  │
│  └── Deduplicate within each agent                               │
│                                                                  │
│  Stage 2: CROSS-AGENT VERIFICATION                               │
│  ├── Compare ALL claims from both agents in a unified pass       │
│  ├── For each claim, classify:                                   │
│  │   ├── Supported    — the other agent corroborates this        │
│  │   ├── Contradicted — the other agent directly disputes this   │
│  │   └── Inconclusive — partial overlap or can't determine       │
│  ├── Separate into:                                              │
│  │   ├── Consensus (majority) — claims both agents agree on      │
│  │   └── Novel (minority) — claims unique to one agent           │
│  └── Judge best novel insight across both agents                 │
│                                                                  │
│  Stage 3: SCORING (F1@K)                                         │
│  ├── K = median(totalClaims_A, totalClaims_B)                    │
│  ├── Per agent:                                                  │
│  │   ├── Precision  = supported / total                          │
│  │   ├── Recall@K   = min(supported / K, 1)                     │
│  │   └── VeriScore  = 2 * P * R / (P + R)                       │
│  └── Higher VeriScore = more factually reliable agent            │
└──────────────────────────────────────────────────────────────────┘
```

## Full Flow

```
User Query
  │
  ▼
┌─────────────────────────────────┐
│  1. STAKE PHASE                 │
│  Agent A stakes 0.01 KITE ──┐  │
│  Agent B stakes 0.01 KITE ──┼──▶ Stake Pool (0.02 KITE)
└─────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────┐
│  2. RESPONSE PHASE              │
│  Agent A (OpenAI) ──▶ Response  │
│  Agent B (Gemini) ──▶ Response  │
└─────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────┐
│  3. VERIFICATION (see above)    │
│  Claim extraction → Cross-agent │
│  verification → F1@K scoring    │
│  → Novel insight judging        │
└─────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────┐
│  4. REWARD PHASE                │
│  Stake Pool (0.02 KITE)        │
│  ├── Verifier cut: 10% (0.002) │
│  └── Winner gets: 90% (0.018)  │
│  Loser: gets nothing back      │
└─────────────────────────────────┘
```

## New/Modified Files

```
src/lib/
├── kite/
│   ├── config.ts              # Network config, contract addresses, constants
│   ├── wallets.ts             # AA wallets for Agent A, Agent B, Verifier
│   └── transactions.ts        # Stake, reward, and verifier-cut transactions
├── verifier/
│   ├── claude.ts              # Main verifier orchestrator (runs all 3 stages)
│   ├── claim-extractor.ts     # Stage 1: extract verifiable atomic claims
│   ├── claim-verifier.ts      # Stage 2: cross-agent comparison + classification
│   └── scorer.ts              # Stage 3: compute VeriScore (F1@K) per agent
├── orchestrator/
│   ├── input.ts               # (unchanged) — fans query to both models
│   └── output.ts              # Rewritten: stake → query → verify → score → reward
src/app/
├── api/
│   ├── query/route.ts         # Updated: returns verification + scores + tx data
│   └── wallets/route.ts       # GET: agent wallet addresses + balances
└── page.tsx                   # Updated: show VeriScore breakdown + tx links
```

## Implementation Steps

### Step 1: Install dependencies
- `gokite-aa-sdk` and `ethers` for Kite blockchain wallets/transactions
- `@anthropic-ai/sdk` for the Claude verifier

### Step 2: Kite config (`src/lib/kite/config.ts`)
- Testnet RPC, chain ID 2368, bundler URL
- Contract addresses (test USDT)
- Stake amount constant (e.g., `0.01 KITE`)
- Verifier cut percentage (10%)

### Step 3: Wallets (`src/lib/kite/wallets.ts`)
- 3 AA wallets: Agent A, Agent B, Verifier
- Each backed by a private key from env vars
- Functions: `getWalletAddress(agent)`, `getBalances()`

### Step 4: Transactions (`src/lib/kite/transactions.ts`)
- `stakeFromAgent(agent: "A" | "B")` — transfer stake amount to a pool/escrow address
- `rewardWinner(winner: "A" | "B")` — send 90% of pool to winner
- `payVerifier()` — send 10% of pool to verifier wallet
- All return transaction hashes

### Step 5: Claim Extractor (`src/lib/verifier/claim-extractor.ts`)
VeriScore Stage 1. Uses Claude to extract verifiable atomic claims:
- Process each response sentence-by-sentence with a sliding window (up to 3 preceding + 1 following sentence for context)
- Extract ONLY verifiable claims — skip opinions, hypotheticals, subjective statements, advice, instructions
- Each claim must be self-contained (replace pronouns with named entities using context)
- One claim = one event or one state, with necessary modifiers
- Deduplicate claims within each agent's response
- Returns `{ agentAClaims: string[], agentBClaims: string[] }`

### Step 6: Claim Verifier (`src/lib/verifier/claim-verifier.ts`)
VeriScore Stage 2. Uses Claude for unified cross-agent comparison:
- Takes all claims from both agents
- In a SINGLE pass, classifies every claim using ternary labels:
  - **Supported** — the other agent corroborates this claim
  - **Contradicted** — the other agent directly disputes this claim
  - **Inconclusive** — partial overlap or can't determine
- Separates results into:
  - **Consensus insights** — claims that both agents make (supported by both)
  - **Novel insights** — claims unique to only one agent, tagged with source agent
- Judges which agent's novel insight is the most valuable
- Returns the full classified claim list + consensus + novel + winner

### Step 7: Scorer (`src/lib/verifier/scorer.ts`)
VeriScore Stage 3. Computes F1@K per agent:
```
K = median(agentA.totalClaims, agentB.totalClaims)
Per agent:
  Precision  = supportedClaims / totalClaims
  Recall@K   = min(supportedClaims / K, 1)
  VeriScore  = (2 * P * R) / (P + R)    // 0 if R = 0
```
Returns `{ agentAScore: number, agentBScore: number }`

### Step 8: Verifier Orchestrator (`src/lib/verifier/claude.ts`)
Ties stages 1-3 together:
1. Call claim extractor → get claims for both agents
2. Call claim verifier → get classifications + consensus + novel + winner
3. Call scorer → compute VeriScores
4. Return complete `VerificationResult`

### Step 9: Rewrite output orchestrator (`src/lib/orchestrator/output.ts`)
1. Stake from both agents
2. Send both responses to Claude Verifier (stages 1-3)
3. Get verification result (claims + scores + winner)
4. Execute reward transactions (winner + verifier cut)
5. Return everything

### Step 10: Wallet API route (`src/app/api/wallets/route.ts`)
- `GET /api/wallets` — returns addresses and balances for Agent A, Agent B, Verifier

### Step 11: Update query API route (`src/app/api/query/route.ts`)
- Return full verification breakdown, VeriScores, and transaction hashes

### Step 12: Update frontend (`src/app/page.tsx`)
- **Wallet panel**: Agent A, Agent B, Verifier addresses + balances
- **VeriScore cards**: each agent's score displayed as a gauge/number
- **Agent response panels** (one for Agent A, one for Agent B):
  - Show the agent's full response with each claim color-coded inline:
    - **Green background** (`bg-green-100`) — Supported claims
    - **Red background** (`bg-red-100`) — Contradicted claims
    - **Yellow background** (`bg-yellow-100`) — Inconclusive claims
    - **Green text with green left border** (`text-green-700 border-l-green-500`) — Novel insights
  - Claim count summary bar at top of each panel (X supported, Y contradicted, Z inconclusive)
- **Combined analysis section**:
  - Consensus insights list
  - Novel insights list (tagged per agent, highlighted green)
  - Winner announcement with best novel insight + reasoning
- **Transaction links** to Kite testnet explorer

## Environment Variables

```
OPENAI_API_KEY=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...            # For Claude verifier
AGENT_A_PRIVATE_KEY=...          # Testnet wallet key for Agent A
AGENT_B_PRIVATE_KEY=...          # Testnet wallet key for Agent B
VERIFIER_PRIVATE_KEY=...         # Testnet wallet key for Verifier
```

## Type Definitions

```typescript
// --- Stage 1: Claim Extraction ---
interface ExtractedClaims {
  agentAClaims: string[];
  agentBClaims: string[];
}

// --- Stage 2: Cross-Agent Verification ---
interface ClaimClassification {
  claim: string;
  originalText: string;    // exact sentence/span from the agent's response (for frontend highlighting)
  source: "A" | "B";
  status: "supported" | "contradicted" | "inconclusive" | "novel";
}

interface CrossAgentResult {
  allClaims: ClaimClassification[];
  consensusInsights: string[];
  novelInsights: { agent: "A" | "B"; insight: string }[];
  bestNovelInsight: {
    agent: "A" | "B";
    insight: string;
    reasoning: string;
  };
  winner: "A" | "B";
}

// --- Stage 3: Scoring ---
interface AgentScore {
  total: number;
  supported: number;
  contradicted: number;
  inconclusive: number;
  precision: number;      // supported / total
  recallAtK: number;      // min(supported / K, 1)
  veriScore: number;      // F1@K
}

// --- Combined Result ---
interface VerificationResult {
  claims: CrossAgentResult;
  scores: {
    K: number;
    agentA: AgentScore;
    agentB: AgentScore;
  };
}
```
