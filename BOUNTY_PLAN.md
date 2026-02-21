# Plan: Kite AI Hackathon Bounty Completion

## Context

This hackathon project ("Sniper") already has a working multi-agent AI orchestrator with VeriScore verification and AA wallet staking on Kite testnet. However, 3 major bounty requirements are completely missing: **x402 payment flows**, **verifiable agent identity**, and **security controls**. This plan adds all missing features in a lean, ship-today approach.

### Current Bounty Scorecard

| Requirement | Status |
|---|---|
| Build on Kite AI Testnet | DONE |
| x402-style payment flows | **NOT DONE** |
| Verifiable agent identity | **NOT DONE** |
| Autonomous execution | DONE |
| Multi-agent coordination | DONE |
| Gasless/abstracted UX | DONE |
| Security controls | **NOT DONE** |
| Clear visualization | MOSTLY DONE |
| Graceful failure (insufficient funds) | PARTIAL |
| Deployment (live URL) | **NOT DONE** |
| README / docs | **NOT DONE** |

---

## Implementation Plan

### Phase 1: Security Controls (~15 min)

**New file: `src/lib/x402/security.ts`**
- In-memory rate limiter (10 req/min, resets on cold start — fine for hackathon)
- Spending cap tracker per agent (max 0.01 KITE total)
- `preflightBalanceCheck(agent)` — checks KITE + USDT balance before staking, returns specific "insufficient funds" error with actual vs needed amounts

**Modify: `src/app/api/query/route.ts`**
- Add rate limit check at top of handler (before SSE stream starts)
- Add pre-flight balance check with specific error messaging (before staking step)
- SSE step: "Checking agent balances..." → "Balance OK: Agent A 0.4445 KITE, Agent B 0.4449 KITE"

---

### Phase 2: Verifiable Agent Identity (~15 min)

**Modify: `src/lib/kite/wallets.ts`** — add 2 functions:
- `signIdentityChallenge(agent, challenge)` — signs SHA-256(query + nonce) with EOA key
- `verifyIdentity(address, challenge, signature)` — recovers signer via `ethers.verifyMessage`, compares to expected address

**Modify: `src/app/api/query/route.ts`** — add identity step before staking:
- Generate challenge = `sha256(query + timestamp)`
- Both agents sign the challenge in parallel
- Verify signatures match their known EOA addresses
- Send new SSE event type `"identity"` with addresses, signatures, and verified status

**Modify: `src/app/page.tsx`** — display identity:
- New state `identity` populated from SSE `"identity"` event
- Green "Verified" badge + truncated EOA address in each agent's response panel header

---

### Phase 3: x402 Payment Flow (~45 min)

**Design**: Instead of calling OpenAI/Gemini directly, agents go through an x402-style flow where they must authorize payment before getting inference. The signature verification happens in-process (no extra HTTP round-trip), but a real `/api/x402/inference` endpoint also exists for external callers.

The staking transactions already handle on-chain settlement, so x402 inference payments use **signature-based authorization** (agent signs intent to pay) logged alongside staking. This avoids adding 2 more slow on-chain txs to the pipeline.

**New file: `src/lib/x402/types.ts`**
- `PaymentRequired` — 402 response body (x402Version, scheme, network, amount, payTo, resource)
- `PaymentHeader` — X-PAYMENT header format (from, amount, resource, nonce, signature)
- Constants: `INFERENCE_FEE = "0.00005"` KITE per inference call

**New file: `src/lib/x402/middleware.ts`**
- `createPaymentRequired(model)` — builds 402 response with pricing for a given model
- `createAgentPayment(agent, requirement)` — signs payment authorization with agent's EOA key
- `verifyPayment(payment)` — verifies signature, returns `{ valid, error }`

**Modify: `src/lib/kite/wallets.ts`** — add:
- `signMessageAsAgent(agent, message)` — signs arbitrary message with agent's EOA key (keeps `getPrivateKey` private)

**New file: `src/app/api/x402/inference/route.ts`** — real HTTP x402 endpoint:
- POST with `{model, prompt}` → returns 402 if no X-PAYMENT header
- With valid X-PAYMENT → verifies signature → calls OpenAI or Gemini → returns result
- This endpoint exists as proof of protocol for external callers/judges

**Modify: `src/lib/orchestrator/input.ts`** — route through x402 flow:
- New `queryViaX402(agent, model, query, queryFn)` wrapper:
  1. Get payment requirements (simulated 402)
  2. Check spending cap
  3. Agent signs payment
  4. Verify signature
  5. Execute inference
  6. Return result + x402 payment metadata
- Add `x402` field to `ModelResponse` interface: `{ fee, signature, payTo, verified }`

**Modify: `src/app/api/query/route.ts`** — add x402 steps to SSE:
- Step: "Agent A paying 0.00005 KITE for gpt-4o-mini inference (x402)..."
- Step: "Agent A payment verified (sig: 0x1234...)"
- Include x402 payment info in the final `"result"` event

**Modify: `src/app/page.tsx`** — display x402 payments:
- New section in results: "x402 Payment Log" showing per-agent inference fees, signatures, and verification status
- Payment flow visualization in the live step log (distinct color for x402 steps)

---

### Phase 4: Deployment + README (~15 min)

**New file: `vercel.json`**
- Set `maxDuration: 120` for `/api/query` route (SSE streaming needs time)
- Set `maxDuration: 60` for `/api/x402/inference`

**Rewrite: `README.md`**
- Project description and one-liner
- ASCII architecture diagram showing full pipeline
- Bounty requirement mapping table
- Setup instructions (env vars, npm install, npm run dev)
- Deployment instructions (Vercel)
- Tech stack list

**Deploy to Vercel:**
- Connect repo, set env vars in dashboard, deploy

---

## File Change Summary

| File | Action | What |
|---|---|---|
| `src/lib/x402/types.ts` | NEW | x402 type definitions + constants |
| `src/lib/x402/middleware.ts` | NEW | Payment creation, signing, verification |
| `src/lib/x402/security.ts` | NEW | Rate limiter, spending caps, balance checks |
| `src/app/api/x402/inference/route.ts` | NEW | Real HTTP x402-gated inference endpoint |
| `src/lib/kite/wallets.ts` | MODIFY | Add signMessageAsAgent, signIdentityChallenge, verifyIdentity |
| `src/lib/kite/transactions.ts` | MODIFY | Export transferForInference wrapper |
| `src/lib/orchestrator/input.ts` | MODIFY | Route inference through x402 flow |
| `src/app/api/query/route.ts` | MODIFY | Add security checks, identity, x402 logging |
| `src/app/page.tsx` | MODIFY | Add identity badges, x402 payment log, security info |
| `vercel.json` | NEW | Vercel deployment config |
| `README.md` | REWRITE | Full bounty-aligned documentation |

---

## Verification

1. Run `npm run dev` and submit a query
2. SSE log should show: balance check → identity verification → staking → x402 inference payments → AI responses → VeriScore → rewards
3. UI should display: verified identity badges, x402 payment log, transaction links
4. Hit `/api/x402/inference` directly without X-PAYMENT header → should get 402 response
5. Hit `/api/x402/inference` with valid X-PAYMENT → should get inference result
6. Rapid-fire 11+ queries → should get rate limit error
7. Deploy to Vercel and verify live URL works end-to-end
