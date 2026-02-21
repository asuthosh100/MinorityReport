# Minority Report

A multi-agent AI orchestrator built on **Kite AI Testnet** that pits three competing LLMs against each other, extracts and cross-verifies their claims using VeriScore, and rewards the most accurate agent from a staked escrow pool — all on-chain.

**Live Demo:** [openclaw-run-rhino.vercel.app](https://openclaw-run-rhino.vercel.app)

---

## How It Works

```
User Query
    |
    v
+-------------------+     +-------------------+     +-------------------+
|   Agent A (GPT)   |     |  Agent B (Gemini) |     |  Agent C (Claude) |
|  gpt-4o-mini      |     |  gemini-2.0-flash |     |  claude-sonnet-4  |
+-------------------+     +-------------------+     +-------------------+
    |   escrow 0.0001 KITE each into verifier pool
    v
+-----------------------------------------------------------------+
|                    VeriScore Verification                        |
|  1. Extract atomic claims from each agent's response            |
|  2. Cross-verify claims against web sources                     |
|  3. Classify as supported / inconclusive / contradicted         |
+-----------------------------------------------------------------+
    |
    v
+-----------------------------------------------------------------+
|                   Cross-LLM Classifier                          |
|  - Identify majority consensus vs. minority/novel claims        |
|  - Compute precision & recall per agent                         |
|  - Flag red flags and cluster consensus themes                  |
+-----------------------------------------------------------------+
    |
    v
+-----------------------------------------------------------------+
|                     Reward Distribution                          |
|  Winner (highest precision) receives 90% of escrow pool         |
|  Verifier retains 10% as a service fee                          |
+-----------------------------------------------------------------+
```

### The Pipeline Step-by-Step

1. **Security checks** — rate limiting (10 req/min), per-agent spending caps (0.01 KITE max), and on-chain balance verification
2. **Escrow** — each of the 3 agents locks 0.0001 KITE into the verifier's AA wallet (total pool: 0.0003 KITE)
3. **Query** — all 3 models answer the same user query in parallel via `Promise.allSettled()`
4. **VeriScore** — an external VM extracts atomic, verifiable claims from each response and checks them against web sources
5. **Classifier** — a second VM performs cross-LLM analysis: majority/minority claim classification, consensus clustering, and annotated insights
6. **Scoring** — precision (supported / total claims) determines the winner; ties broken by supported count
7. **Reward** — the verifier sends 90% of the pool to the winner's AA wallet and retains 10%
8. **Display** — the frontend streams every step in real-time via SSE and renders a rich verification dashboard

---

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── query/route.ts          # Main SSE endpoint — orchestrates the full pipeline
│   │   └── wallets/route.ts        # GET wallet addresses & balances
│   ├── page.tsx                    # React UI (agent cards, claims, novel insights)
│   ├── layout.tsx                  # App shell & metadata
│   └── globals.css                 # Tailwind dark theme
│
└── lib/
    ├── models/
    │   ├── openai.ts               # GPT-4o-mini client
    │   ├── gemini.ts               # Gemini 2.0 Flash client
    │   └── claude.ts               # Claude Sonnet 4 client
    │
    ├── orchestrator/
    │   ├── input.ts                # Parallel query to all 3 models
    │   └── output.ts               # Verification + reward orchestration
    │
    ├── verifier/
    │   ├── claude.ts               # Main verification orchestrator
    │   ├── claim-extractor.ts      # VeriScore Stage 1: claim extraction via external VM
    │   └── classifier.ts           # Cross-LLM classifier via external VM
    │
    ├── kite/
    │   ├── config.ts               # Kite testnet RPC, chain ID, escrow constants
    │   ├── wallets.ts              # AA wallet management (Gokite AA SDK)
    │   └── transactions.ts         # Escrow deposits & reward distribution
    │
    ├── x402/
    │   └── security.ts             # Rate limiter, spending caps, balance checks
    │
    └── types.ts                    # AgentId type ("A" | "B" | "C")
```

---

## Features

- **Multi-agent competition** — 3 frontier LLMs compete on the same query with economic skin in the game
- **VeriScore claim verification** — atomic claim extraction and web-source cross-verification
- **Cross-LLM classifier** — identifies majority consensus, minority novel insights, red flags, and consensus clusters
- **On-chain escrow & rewards** — Kite testnet transactions with Account Abstraction (gasless UX)
- **Real-time streaming** — SSE-powered step-by-step updates as the pipeline progresses
- **Security controls** — rate limiting, per-agent spending caps, on-chain balance pre-checks
- **Novel claims panel** — highlights unique, high-value insights that only one agent surfaced
- **Transaction explorer links** — every escrow and reward tx links to Kite testnet explorer

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.6, React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 (custom dark theme) |
| AI Models | OpenAI GPT-4o-mini, Google Gemini 2.0 Flash, Anthropic Claude Sonnet 4 |
| Blockchain | Kite AI Testnet (Chain ID 2368), Gokite AA SDK, ethers v6 |
| Verification | VeriScore VM (claim extraction), Classifier VM (cross-LLM analysis) |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
git clone https://github.com/asuthosh100/openclaw.git
cd openclaw
npm install
```

### Environment Variables

Create a `.env.local` file in the project root:

```env
# AI Model API Keys
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIza...
MY_ANTHROPIC_API_KEY=sk-ant-...

# Agent Wallet Private Keys (Kite Testnet EOAs)
AGENT_A_PRIVATE_KEY=0x...
AGENT_B_PRIVATE_KEY=0x...
AGENT_C_PRIVATE_KEY=0x...
VERIFIER_PRIVATE_KEY=0x...
```

Each agent private key backs an EOA that derives an Account Abstraction wallet on Kite testnet. Fund these AA wallets with testnet KITE before running queries.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and submit a query.

---

## Kite Testnet Details

| Parameter | Value |
|---|---|
| Network | Kite AI Testnet |
| RPC | `https://rpc-testnet.gokite.ai` |
| Chain ID | 2368 |
| Explorer | [testnet.kitescan.ai](https://testnet.kitescan.ai) |
| Settlement Token | `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` (USDT) |
| Escrow per Agent | 0.0001 KITE |
| Verifier Cut | 10% of pool |
| Winner Reward | 90% of pool |

### Transaction Flow

```
Agent A  ──  0.0001 KITE  ──┐
Agent B  ──  0.0001 KITE  ──┤──▶  Verifier Pool (0.0003 KITE)
Agent C  ──  0.0001 KITE  ──┘          |
                                       ▼
                              Winner gets 0.00027 KITE
                              Verifier keeps 0.00003 KITE
```

---

## Security

The `x402` security module (`src/lib/x402/security.ts`) enforces three gates before any query executes:

1. **Rate Limiter** — 10 requests per minute (in-memory, resets on cold start)
2. **Spending Caps** — max 0.01 KITE cumulative spend per agent
3. **Pre-flight Balance Check** — on-chain KITE balance verification before escrow

---

## Deployment

```bash
npx vercel --prod
```

Ensure all environment variables are configured in the Vercel project settings.

---

## Team

Built for the Kite AI hackathon.
