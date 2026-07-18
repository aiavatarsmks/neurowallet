# DECISION 2.3 — On-ramp provider (fiat → crypto)

> Decision framework for the Phase 2.3 "on-ramp v1" (second revenue line).
> Drafted overnight 2026-07-18 as a decision input — **not a final spec.** All
> provider specifics (fees, TON coverage, region availability) marked *(verify)*
> because they move fast and this is past my training cutoff — re-check current
> provider docs before signing anything. Structure mirrors [DECISION_2.2](DECISION_2.2.md).

## The lens that decides it (our constraints)

1. **TON-native first (compliance).** Per `COMPLIANCE_TG.md` we position as a
   TON wallet. The on-ramp should let users buy **TON and USDT (TON)** directly,
   not only ETH/BTC. A provider with strong TON support is worth more to us than
   one with marginally better EVM coverage. *(verify each provider's TON + Jetton
   USDT support)*
2. **EU-first (business context).** Target users are EU freelancers/self-employed
   (see `CLAUDE.md` Business Context). SEPA / instant-SEPA and EU card support +
   EU KYC matter more than US ACH. *(verify EU coverage + payment methods)*
3. **Hosted, provider-owned KYC.** We do NOT want to touch KYC data or hold
   fiat — invariant "fiat = partner-driven regulated surface, not build-then-
   license". So: **hosted flow** (their widget/redirect), we never collect PII.
4. **Durable, idempotent order state via webhooks.** Plan acceptance: "order
   state durable/idempotent через webhooks; неподдерживаемый регион — честный
   отказ до KYC." → we need a `ramp_orders` table + a signed-webhook reconciler.
5. **Revenue.** Plan target = **partner fee 0.5–1.25%**. All majors share a
   partner/affiliate margin — confirm the exact split *(verify)*.

## Comparison (verify all cells before committing)

| Provider | TON / USDT-TON *(verify)* | EU methods *(verify)* | Hosted KYC | Webhooks | Partner fee *(verify)* | Notes |
|---|---|---|---|---|---|---|
| **MoonPay** | TON historically supported; confirm USDT-TON | Cards + SEPA | ✅ widget/URL | ✅ signed | rev-share, tiered | Widely integrated, strong brand-trust; check TON asset list |
| **Transak** | Broad chain list incl. TON *(verify)* | Cards + SEPA + local | ✅ widget/URL | ✅ | rev-share configurable | Often cited as widest asset/chain coverage |
| **Ramp Network** | Confirm TON | Cards + Open Banking (EU) | ✅ | ✅ | rev-share | Strong EU/Open-Banking UX |

> None assumed correct — the table is the **shape of the question**, not an
> answer. Fill each *(verify)* cell from current docs, then decide.

## Recommendation (default, pending verification)

**Lead with whichever of Transak / MoonPay confirms (a) direct TON + USDT-TON
purchase and (b) EU SEPA + cards**, because TON-native purchase is our
compliance-aligned differentiator. If TON buy is weak across all three, scope
v1 to "buy TON/USDT-TON" via the best-covered one and show other assets as
"coming", rather than leading users to buy ETH they then can't easily use in a
TON-first UX.

Single provider for v1 (like swap → 1inch): one hosted flow, one webhook
reconciler, `region capability flags` gating availability. Add a second provider
only if region/asset gaps demand it.

## Safe scaffolding I can build now (no account, behind a flag) — needs your OK

If you want me to start before the provider is chosen, the **provider-agnostic**
parts are safe and reversible (flag OFF, additive migration like 0010):

- `ramp_orders`, `provider_sessions`, `kyc_statuses` tables (+ RLS, service-role
  writes) — schema only, no secrets.
- A capability-flag module (`onramp-config.ts`) + region gate (pure, testable).
- A flag-gated `/api/onramp/session` stub returning `{ status: 'unavailable' }`
  until a provider + key exist.
- Tests for the region gate + order state machine.

I did **not** build this unprompted — it presupposes the order model, and I'd
rather you confirm the provider first so the schema matches their webhook shape.

## What's blocking a final commit (needs you)

1. **Create the provider account** → API key + webhook secret (account creation
   is yours; I can't). Key is server-only (proxy like OpenRouter/1inch).
2. **Product/pricing decision:** target partner-fee %, and whether v1 is
   "TON/USDT-TON only" or broader.
3. **Confirm** hosted-KYC (we never touch PII) and the launch regions.
4. Verify the *(verify)* cells against current provider docs.
