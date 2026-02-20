# OpenClaw - Multi-Model Query Orchestrator (Phase 1)

## Overview

User submits a query → **Input Orchestrator** fans it out to OpenAI & Gemini in parallel → both responses feed into an **Output Orchestrator** → final result returned to the user.

## Architecture

```
┌──────────┐     ┌─────────────────────┐     ┌──────────┐
│          │     │  Input Orchestrator  │────▶│  OpenAI  │──┐
│  User    │────▶│  (API Route)        │     └──────────┘  │   ┌──────────────────────┐     ┌──────┐
│  Query   │     │                     │                    ├──▶│  Output Orchestrator  │────▶│Result│
│          │     │                     │     ┌──────────┐  │   └──────────────────────┘     └──────┘
└──────────┘     └─────────────────────┘────▶│  Gemini  │──┘
                                             └──────────┘
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **AI SDKs**: `openai` (official), `@google/generative-ai` (official Gemini SDK)
- **Styling**: Tailwind CSS (ships with Next.js)

## File Structure

```
openclaw/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout
│   │   ├── page.tsx                # Main UI — query input + results display
│   │   └── api/
│   │       └── query/
│   │           └── route.ts        # POST endpoint: input orchestrator → models → output orchestrator
│   ├── lib/
│   │   ├── models/
│   │   │   ├── openai.ts           # OpenAI client + query function
│   │   │   └── gemini.ts           # Gemini client + query function
│   │   └── orchestrator/
│   │       ├── input.ts            # Input orchestrator: fans query out to both models in parallel
│   │       └── output.ts           # Output orchestrator: takes both responses, produces final answer
├── .env.local                      # API keys (OPENAI_API_KEY, GEMINI_API_KEY)
├── package.json
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

## Implementation Steps

### Step 1: Scaffold Next.js project
- Run `npx create-next-app@latest` with TypeScript, Tailwind, App Router, src/ directory
- Install AI SDKs: `openai`, `@google/generative-ai`

### Step 2: Create model clients (`src/lib/models/`)
- **`openai.ts`** — Exports an async function `queryOpenAI(prompt: string): Promise<string>` that calls GPT-4o-mini and returns the text response.
- **`gemini.ts`** — Exports an async function `queryGemini(prompt: string): Promise<string>` that calls Gemini 1.5 Flash and returns the text response.
- Both handle errors gracefully and return error strings if a model fails (so one failure doesn't break the whole pipeline).

### Step 3: Build the orchestrators (`src/lib/orchestrator/`)
- **`input.ts`** — `inputOrchestrator(query: string)`: Calls `queryOpenAI` and `queryGemini` in parallel using `Promise.allSettled`. Returns both results (or error info if one failed).
- **`output.ts`** — `outputOrchestrator(query: string, responses: { openai: string, gemini: string })`: Takes the original query + both model responses and synthesizes a final answer. For Phase 1, this will call one of the models (e.g., OpenAI) with a meta-prompt like: *"Given these two AI responses to the query, synthesize the best answer."*

### Step 4: Create the API route (`src/app/api/query/route.ts`)
- `POST /api/query` — Accepts `{ query: string }` in the body.
- Calls input orchestrator → gets both responses → calls output orchestrator → returns `{ result, individual_responses }` as JSON.

### Step 5: Build the frontend (`src/app/page.tsx`)
- Simple form: text input + submit button.
- On submit, POST to `/api/query`.
- Display:
  - The synthesized final answer from the output orchestrator.
  - Collapsible sections showing the individual OpenAI and Gemini responses.
- Loading state while waiting for the response.

### Step 6: Environment setup
- Create `.env.local` template (added to `.gitignore`) with `OPENAI_API_KEY` and `GEMINI_API_KEY` placeholders.

## Key Design Decisions

1. **`Promise.allSettled` over `Promise.all`** — If one model fails, we still get the other's response instead of failing entirely.
2. **Output orchestrator uses a model call** — Rather than naive concatenation, we use a model to intelligently synthesize the two responses.
3. **Separation of concerns** — Model clients, orchestrators, and API route are cleanly separated so future models can be added easily.
4. **Server-side only API keys** — Keys live in `.env.local` and are only accessed in the API route (server-side), never exposed to the browser.
