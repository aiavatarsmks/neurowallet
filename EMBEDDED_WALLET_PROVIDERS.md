# Embedded / MPC wallet providers — Phase 2.1 (DECISION: Web3Auth)

> **Decision (2026-07-04, Maksim): Web3Auth for Phase 2.1.** Rationale and the
> grounded Turnkey-vs-Web3Auth detail are in the section below. **Nothing is
> integrated** — real onboarding integration is deferred until the Phase 1 gate
> passes; the only active work is an isolated signing PoC (see PoC plan).
> Compiled 2026-07-04.

## Decision — Web3Auth (grounded facts)

Chosen for the Phase 2.1 beta over Turnkey (kept as fallback). Verified facts:

| Axis | **Web3Auth (chosen)** | **Turnkey (fallback)** |
|---|---|---|
| **Pricing at our scale** | **Free ≤ 1,000 MAW**, then **$0.02/MAU** (Base/Growth/Scale/Enterprise). Friends-testers = €0. [7][8] | Transaction/signing-based ("affordable", 50–100 ms signing); no public per-MAU figure → quote needed. [9] |
| **Custody (who holds keys)** | **MPC / Shamir shares.** In a 2/3 setup: user holds a share, Web3Auth's **5/9 node network** holds one, backup/social another. No single party (incl. Web3Auth) can reconstruct; reassembled client-side at sign time. [10] | **TEE, no shares.** Full key lives only inside **AWS Nitro secure enclaves**, enclave-bound encryption; raw key never leaves and no one incl. Turnkey can access it — credential + policy authorize signing. [9] |
| **Integration w/ our stack** | Lighter: higher-level SDK, social/email login + MPC recovery built in; **custom-JWT verifier lets us keep Supabase auth** (feed our JWT to gate the share); keep `lib/crypto` for all 5 chains via MPC Core Kit (ed25519+secp256k1). ~1–2 wk to beta. | Heavier: low-level signer, we build auth→Turnkey mapping + recovery UX; keeps Supabase auth untouched; chain-agnostic signing fits `lib/crypto`. ~2–4 wk. |
| **Telegram Mini App** | **Yes — first-party.** Dedicated TMA support + guide + SDKs designed for TMA. [11] | Not found — API works in a TMA WebView but no advertised TMA-specific integration. |

**Custody nuance:** both are non-custodial. Turnkey's TEE is the *cleaner* custody
story (key never leaves, no share transport) and is a candidate for later prod
hardening; Web3Auth's MPC is a well-accepted self-custodial model and ships
faster with first-party TMA support — decisive for the beta.

## Why we might move (recap)

Today keys live encrypted in `localStorage`, which the Telegram WebView can
evict (see `LEGACY_DERIVATION_JUNE_USERS.md` / the durable-storage note). An
embedded MPC/self-custodial provider would remove device-local key storage as
the source of truth, add social/email/passkey recovery, and cut the "seed
phrase" friction — while (ideally) staying non-custodial.

## Hard constraints (these decide the shortlist)

1. **Five chains: ETH, BTC, SOL, TRX, TON.** This is the make-or-break axis.
2. **Non-custodial** (CLAUDE.md invariant): the user must control the key; the
   provider must not be able to move funds unilaterally.
3. **Telegram Mini App WebView**: social login / passkeys have WebView
   limitations → plan already anticipates an external-browser-tab fallback.
4. **Reuse our existing chain layer**: `frontend/lib/crypto/*` already builds
   addresses and transactions for all 5 chains. Ideal provider replaces only
   **key custody + signing**, not our tx construction.

## The decisive lens: signing curves, not "chain logos"

- **secp256k1** → ETH, BTC, TRX. **ed25519** → SOL, TON.
- Providers that expose **raw signing on both curves** ("chain-agnostic")
  automatically cover all 5 chains — we keep our `lib/crypto` tx builders and
  just call their signer. Turnkey and Web3Auth explicitly work this way
  (secp256k1 + ed25519), so any chain on those primitives is supported without
  provider-side work. [1][4][5]
- Providers that only ship **high-level EVM+Solana helpers** (typical consumer
  embedded SDKs) can't reach TON/TRX/BTC unless they also offer a raw-signing
  escape hatch. So "does it list TON?" matters less than "does it expose raw
  ed25519 + secp256k1 signing?"

**None of the surveyed providers advertise turnkey (lowercase) TON *chain*
support out of the box** — TON is reachable via raw ed25519 signing + our TON
tx layer. Confirm this in a PoC (below) before committing.

## Comparison

| Provider | Custody model | Raw signing (secp256k1 / ed25519) | Covers our 5 chains? | Telegram WebView | Auth / recovery | Pricing model |
|---|---|---|---|---|---|---|
| **Turnkey** | Non-custodial, TEE-based key mgmt + policy engine | **Yes / Yes** — chain-agnostic (EVM, Solana, Bitcoin, TRON explicitly; TON via ed25519) [1] | **Yes** (TON via raw ed25519 + our tx layer) | Needs verify — API/headless signer, embeddable | Passkey / API-key sessions, policy-based | MAU + signing-based *(verify)* |
| **Web3Auth** (MetaMask Embedded) | Non-custodial MPC/SSS (user holds a share) | **Yes / Yes** — ed25519 in MPC; documented Tron integration [2][4] | **Yes** (TON via ed25519) | Documented mobile/WebView SDKs; social login needs external-tab fallback | Social / email / passkey, MPC recovery | Free tier + per-MAU *(verify)* |
| **Privy** (Stripe, acq. Jun 2025) | Non-custodial embedded (self-custodial shares) | Partial — EVM, Solana, Bitcoin, Stellar; TON/TRX not advertised [search] | **Gaps** (TRX/TON unclear) — verify raw-signing escape hatch | Widely used in mobile web | Email / social / passkey | Per-MAU *(verify)* |
| **Dynamic** | Non-custodial embedded + MPC | EVM + Solana focus; passkey-authorized MPC [5] | **Gaps** (TON/TRX/BTC) | Good web support | Social / passkey | Per-MAU *(verify)* |
| **Coinbase Embedded (CDP)** | MPC (Coinbase-operated shares) | EVM + Solana focus | **Gaps** (BTC/TON/TRX) | Verify | Email / social | Per-MAU *(verify)* |
| **Fireblocks** | Enterprise MPC (custodial-leaning) | Broad incl. many chains | Likely (enterprise) | Not a consumer WebView fit | Institutional | Enterprise contract |

*Sources are indicative; the "Gaps" cells especially need per-provider doc
confirmation — chain lists move fast.*

## Shortlist & rationale (historical — decision made above)

1. **Web3Auth — CHOSEN.** Multi-curve MPC (ed25519 for TON/Solana, secp256k1
   for ETH/BTC/TRX) with social/passkey recovery baked in, first-party Telegram
   Mini App support, free ≤1k MAW, and a custom-JWT verifier that keeps our
   Supabase auth. Fastest path to the beta.
2. **Turnkey — fallback.** Cleaner TEE custody story; kept in reserve for prod
   hardening or if the Web3Auth PoC fails.
3. **Privy / Dynamic / Coinbase** — EVM+Solana-centric; not pursued (TON/TRX/BTC
   gaps).

## Telegram WebView caveat

Social login popups and passkeys are constrained inside Telegram's in-app
WebView (matches the plan's existing note). Whichever provider: the auth flow
likely needs an **external-browser-tab fallback**, and this must be part of the
PoC — a provider that's great on the web can still fail inside Telegram.

## Verification / PoC plan (before any decision)

A ~1-2 day spike per finalist, no production wiring:

1. **Sign a real TON tx and a real TRX tx** through the provider's raw signer,
   feeding it our existing `lib/crypto/ton-tx.ts` / `tron-tx.ts` builders.
   This is the make-or-break test — if TON ed25519 signing + our tx layer
   round-trips on testnet, the provider clears the hard constraint.
2. **Telegram WebView auth**: run the provider's login inside the actual Mini
   App; confirm the external-tab fallback works and returns a usable session.
3. **Custody check**: confirm the user (not the provider) can always authorize;
   read the exact share/custody model in writing.
4. **Pricing at our scale**: get the current per-MAU tier for the expected
   tester → early-user MAU band (numbers here are all *(verify)*).
5. **Migration path**: how do existing seed-based users move? (Import seed into
   the provider vs. fresh provider wallet + sweep — ties into the legacy
   BTC/TON derivation question.)

## Status

**Prep only — not integrated, no dependency added, no code touched.** Choosing
a provider and running the PoC needs Maksim's go-ahead (it's a custody/
architecture fork, and Phase 2 is gated on the Phase 1 usability run regardless).

## Sources

- [1] [Top 7 Web3Auth Alternatives in 2026 (Openfort) — Turnkey chain-agnostic secp256k1+ed25519, EVM/Solana/Bitcoin/TRON](https://www.openfort.io/blog/web3auth-alternatives)
- [2] [Web3Auth — Integrate with the Tron Blockchain](https://web3auth.io/docs/connect-blockchain/evm/tron/web)
- [3] [Fireblocks — Embedded Wallet Infrastructure Comparison (Fireblocks vs Privy vs Turnkey)](https://www.fireblocks.com/report/compare-embedded-wallet-infrastructure)
- [4] [Web3Auth blog — Introducing Ed25519 in Web3Auth's MPC](https://blog.web3auth.io/introducing-ed25519-in-web3auths-mpc-secure-signing-for-dapps-and-wallets/)
- [5] [Openfort — Top 10 Embedded Wallets in 2026 (pricing, auth, smart accounts)](https://www.openfort.io/blog/top-10-embedded-wallets)
- [6] [Turnkey — Embedded Wallets docs](https://docs.turnkey.com/embedded-wallets/overview)
- [7] [Web3Auth — Pricing (free ≤1,000 MAW, then $0.02/MAU)](https://web3auth.io/pricing.html)
- [8] [Web3Auth](https://web3auth.io/)
- [9] [Turnkey review 2026 — TEE/AWS Nitro, no shares, non-custodial, tx-based pricing](https://cryptoadventure.com/turnkey-review-2026-embedded-wallet-infrastructure-key-control-and-the-real-custody-tradeoff/)
- [10] [Web3Auth — Multi-Party Computation (Shamir shares, 5/9 network, 2/3 self-custodial)](https://web3auth.io/docs/features/mpc)
- [11] [Web3Auth — Unlock the Power of Telegram Mini-Apps](https://blog.web3auth.io/unlock-the-power-of-telegram-mini-apps-with-web3auth/)
