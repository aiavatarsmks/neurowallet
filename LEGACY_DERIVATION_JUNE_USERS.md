# Legacy BTC/TON derivation — "June users" (RESOLVED — accept + document)

> **Decision (2026-07-04, Maksim): accept + document. No code change.**
> Confirmed that no June tester holds real assets on the old addresses (only
> empty/test wallets), so no dual-derive and no sweep tool — this is recorded
> as known, accepted behavior (see `KEY_MANAGEMENT.md`). Derivation/import code
> was left untouched throughout. The analysis below is kept for the record.

## TL;DR

Wallets onboarded **before 2026-06-27** derived BTC and TON on **older paths**
than the current code. Those users are **fine on their own device**, but if
they **re-import their seed** (recovery flow, new device, cleared storage),
the app re-derives on the **new** paths and their **old BTC/TON funds become
invisible and unspendable inside NeuroWallet** (not lost — still recoverable in
an external wallet with the correct derivation). The `?recover=1` recovery flow
shipped this week makes re-import more likely, so this is worth deciding now.

## What changed, and when

| Chain | Old path (≤ 2026-06-26) | New path (≥ 2026-06-27) | Commit | Date |
|---|---|---|---|---|
| BTC | `m/44'/0'/0'/0/0` → **P2PKH** (`1...`) | `m/84'/0'/0'/0/0` → **native SegWit** (`bc1q...`) | `2014fed` | 2026-06-27 |
| TON | `m/44'/607'/0'/0/0` (final segments non-hardened) | `m/44'/607'/0'/0'` (all hardened) | `4c0b484` | 2026-06-27 |

- **BTC legacy window:** any wallet created from the start of the project up to
  2026-06-27.
- **TON legacy window:** TON was added 2026-06-25 (`a091534`) on the old path,
  changed 2026-06-27 (`4c0b484`) — so 2026-06-25 … 06-26.

The TON change was a **correctness fix** (ed25519-hd-key requires fully hardened
segments), not a preference — reverting it is not desirable.

## What already works (do NOT panic)

On-device June users are **self-consistent** and fully functional:

- Onboarding wrote the old address + old encrypted key together, and nothing
  re-derives on load (`saveWalletToStorage` runs only during onboarding).
- **BTC send handles legacy P2PKH**: `lib/crypto/btc-tx.ts:getSourceType()`
  detects a `1...` source address and signs as P2PKH. So an on-device June user
  can still display, see balances for, and spend their legacy BTC.
- **TON send** uses the stored key regardless of path, so on-device TON works.

So there is **no problem for a user who never re-imports on that device.**

## What breaks (the actual issue)

`importWalletFromMnemonic()` **always** derives the current (new) paths and
overwrites `wallet_btc_address`/`wallet_btc_enc` and `wallet_ton_address`/
`wallet_ton_enc`. There is no legacy fallback on import. So on **re-import /
recovery / new device / cleared storage**, a June user gets:

- a **new** `bc1q…` BTC address + key — their old `1…` BTC (and any balance on
  it) is no longer known to the app;
- a **new** TON address + key — their old TON balance is no longer known.

Funds are **not lost** — the same seed derives the old paths in any wallet that
supports them — but NeuroWallet will neither show nor spend them after re-import.

**Amplifier:** the `?recover=1` seed re-import path (shipped `cfcdd99`) exists
precisely so blocked users re-import. A June user who re-imports to fix the PIN
dead-end will silently drop their old BTC/TON view.

## Why I did not fix it

Every viable fix changes key derivation / import / custody behavior, which is
explicitly off-limits without your decision. The options each have real
tradeoffs and one must be chosen deliberately:

1. **Dual-derive on import (recommended to evaluate).** On import, derive BOTH
   old and new BTC/TON paths, check both for balance, and keep/display the funded
   one (or both). Preserves access; adds derivation complexity and a UX for
   "you have two BTC addresses". Custody-touching.
2. **Legacy sweep tool.** Detect old-path balance and offer a one-time sweep
   old→new address. Cleanest end state; requires building+signing a real
   transaction from the legacy key. Custody-touching.
3. **Warn before re-import.** Non-custodial mitigation: on the recovery/import
   screen, warn that pre-27-June wallets may hold BTC/TON on an older address and
   link an export/derivation note. Cheapest, doesn't recover funds automatically.
4. **Accept + document only.** If no June tester holds real BTC/TON, do nothing
   but record it. (These are mainnet paths — `bitcoin.networks.bitcoin` — so real
   funds are possible, but tester balances are likely negligible.)

## Resolution

**2026-07-04 — Maksim confirmed no June tester holds real BTC/TON on the old
addresses (only empty/test wallets). Chosen: option 4 (accept + document).**

- No dual-derive, no sweep tool, no warning banner — nothing to build.
- Behavior recorded as known/accepted in `KEY_MANAGEMENT.md`.
- Derivation/import code left unchanged.
- If this ever changes (a user reports funds on a legacy address), reopen and
  revisit options 1–3 above.
