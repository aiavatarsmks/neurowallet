# DECISION 2.2 — Swap router / aggregator

> Comparison for the Phase 2.2 "swap v1" decision (first revenue line). Prices/
> coverage marked *(verify)* — re-check against current docs before signing.
> Compiled 2026-07-08.

## The hard fact for our chain set

We support **ETH, BTC, SOL, TRX, TON**. Swap aggregators are built for
smart-contract chains with on-chain DEXs:

- **BTC** has no on-chain DEX → BTC "swaps" are only possible via **cross-chain
  bridges** (LI.FI-class) or CEX-style on/off, not a same-chain DEX router.
- **TRON** has its own DEXs (SunSwap) that the mainstream EVM aggregators do
  **not** cover.
- **SOL** and **TON** are covered by 1inch (non-EVM support); EVM chains by all.

So **no single aggregator cleanly swaps all 5 of our chains.** Realistic swap v1
= EVM (+ SOL/TON via 1inch); TRX/BTC swaps are out of initial scope or handled
later via a cross-chain provider.

## Comparison

| Router | Chains (vs our set) | Model / fees | API key | Notes |
|---|---|---|---|---|
| **1inch** | EVM ✅, **SOL ✅, TON ✅**, TRX ❌, BTC ❌ | Aggregator; no direct fee (DEXs pay for flow) — **we can add our own markup** = revenue | **Yes** — free Dev plan: 100k calls/mo, 60 rpm *(verify)* | Best fit for our set (only one with SOL+TON+EVM). Same-chain swaps. |
| **LI.FI** | 60+ chains, EVM-heavy + several non-EVM; cross-chain **bridging** | Bridge+DEX aggregation; integrator fee configurable = revenue | **Yes** *(verify tier)* | Best for **cross-chain** (incl. bridging to/from BTC via partners). More complex UX. |
| **0x** | **EVM only** | Swap API; affiliate fee configurable = revenue | **Yes** | No SOL/TON/TRX/BTC — too narrow for us alone. |

## Recommendation

- **Start swap v1 with 1inch** — it's the only one covering our SOL+TON+EVM set
  with same-chain swaps, has a free dev tier, and lets us add a transparent
  markup (the revenue line). Scope v1 to the chains it covers; show TRX/BTC as
  "swap coming" rather than faking it.
- **Add LI.FI later** for cross-chain (and as the path to BTC swaps via bridges)
  when cross-chain is a priority.
- **0x** only if we ever want a pure-EVM fallback — too narrow to lead with.

All three monetize via a configurable integrator/affiliate fee → matches the
plan's "прозрачный fee breakdown, наша маржа видна пользователю." All require an
API key (server-side; **never in the client** — proxy quotes through an API
route like we do for OpenRouter).

## Open questions for you

1. Is swap v1 acceptable as **EVM + SOL + TON only** (TRX/BTC deferred)? If BTC
   swaps are must-have for v1 → we lead with LI.FI (cross-chain) instead.
2. Target integrator fee % (our margin) — needs a product/pricing call.
3. Confirm the invariant: quotes/build proxied via a server route with the API
   key server-only (no client key, no direct client tx insert).

## Sources

- [1inch — cross-chain swaps across 13+ networks (incl. Solana, TON)](https://1inch.com/swap)
- [1inch Business — Swap API (Dev plan free tier)](https://business.1inch.com/products/swap)
- [LI.FI — liquidity aggregation across 60+ chains](https://li.fi/)
- [Best cross-chain swap platforms 2026 (Symbiosis vs 1inch vs Li.Fi)](https://flashift.app/blog/best-cross-chain-swap-platforms-in-2025-symbiosis-1inch-li-fi-and-rango/)
