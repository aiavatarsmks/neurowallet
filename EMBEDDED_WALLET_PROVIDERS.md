# Embedded / MPC wallet providers — comparison for Phase 2.1 (PREP ONLY)

> Sanctioned prep step for Фаза 2.1 ("свести в сравнительную таблицу перед
> интеграцией и согласовать с Максимом"). **Nothing is integrated.** This is a
> decision framework + a shortlist + a verification/PoC plan. Numbers marked
> *(verify)* change frequently and MUST be re-checked against current provider
> docs before any decision. Compiled 2026-07-04.

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

## Shortlist & rationale

1. **Turnkey** — strongest fit on the hard constraint: explicit chain-agnostic
   raw signing (EVM/Solana/Bitcoin/TRON) + ed25519 for TON, non-custodial, keep
   our `lib/crypto` tx layer intact. Trade-off: more of a "signing infra" — we
   build more UX (auth/recovery) ourselves.
2. **Web3Auth** — strong: multi-curve MPC with social/passkey recovery baked in
   (less to build), documented Tron, ed25519 for TON/Solana. Trade-off: MPC
   share model + WebView social-login flow to validate.
3. **Privy / Dynamic / Coinbase** — nicest consumer UX but EVM+Solana-centric;
   only viable if their raw-signing escape hatch cleanly covers TON+TRX+BTC.
   Verify before shortlisting.

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
