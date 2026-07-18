# DECISION 2.9 — Referral program (LAST, after funded actions)

> Decision framework for Phase 2.9. Drafted overnight 2026-07-18 as a decision
> input — **not a final spec.** Referral is explicitly **last** in the GTM order
> (2.6→2.8→2.4→2.7→2.10→2.1→2.3→2.2→**2.9**): it needs funded actions to exist
> first (anti-fraud), so this is prep, not something to ship now.

## Hard invariants (from CLAUDE.md + COMPLIANCE_TG.md — non-negotiable)

1. **Reward only after a FUNDED action** by the invitee — never for signup,
   wallet connect, or onboarding. (Both a growth-quality and anti-fraud rule.)
2. **Compliance:** NEVER reward connecting a non-TON external wallet (direct
   Telegram guideline prohibition). Reward funded actions **inside our wallet**
   only.
3. **Anti-fraud stack is mandatory, not optional:** device fingerprint, Telegram
   account age, velocity rules, self-referral / same-device block, manual review
   of spikes. No rewards flow without these.
4. **Deny by default**; every accrual/payout is an append-only audit_log event.

## The decisions you need to make

| Decision | Options | Notes |
|---|---|---|
| **What counts as "funded"** | first on-ramp order settled / first swap / first non-demo send of ≥ X | Must be an on-chain-verifiable or provider-webhook-confirmed event, not a client claim. Ties to 2.3/2.2 existing. |
| **Reward medium** | (a) fee credit on future swap/on-ramp, (b) Telegram Stars, (c) small in-app TON/USDT credit | (a) is cheapest + self-funding from our margin; (c) is real money out (highest fraud target); Stars = Telegram-native, on-brand. **Lean (a) fee-credit** to start. |
| **Structure** | one-sided (referrer only) vs two-sided | Two-sided converts better but doubles fraud surface — gate hard behind funded-action + anti-fraud. |
| **Amounts / caps** | per-referral reward, monthly cap, cooldown | Pricing call. Caps are an anti-fraud lever. |

## Anti-fraud stack (required before ANY reward pays out)

- **Device fingerprint** — same-device referrer↔referee = auto-reject. (Pick a
  fingerprint lib; note Telegram WebView constraints.)
- **Telegram account age** — new/burner accounts flagged; `initData` gives us the
  user, age heuristics gate velocity.
- **Velocity rules** — N referrals / window per referrer → throttle + review.
- **Self-referral / same-device / same-payment-instrument** blocks.
- **Manual review queue** for spikes (append-only, service-role).

## Safe scaffolding I can build now (behind a flag, no rewards) — needs your OK

Provider-agnostic, reversible (flag OFF, additive migration like 0010):

- `referrals` (referrer_user_id, referee_user_id, code, status:
  pending|funded|rewarded|rejected, funded_at, reason) + `referral_events`
  (+ RLS, service-role writes).
- Pure logic: referral-code gen/parse, self-referral + same-device guards,
  velocity check — all unit-testable with **no reward payout path wired**.
- Feature flag `NEXT_PUBLIC_REFERRAL_ENABLED` (OFF).
- The **funded-gate**: a referral only moves pending→funded when a
  server-verified funded event fires (reuses 2.3/2.2 webhooks / on-chain confirm).
- Tests for the guards + state machine.

I did **not** build this unprompted — the reward medium/amounts are product
decisions, and building the payout path before those are set risks throwaway
code. The schema + guards are the safe, decision-neutral part if you want a head
start.

## What's blocking (needs you)

1. Decisions in the table above (funded-definition, reward medium, structure,
   amounts).
2. Anti-fraud tooling choice (fingerprint provider).
3. This is **last** by design — it should follow 2.3/2.2 (funded actions must
   exist to gate on). Don't ship ahead of them.
