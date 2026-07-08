# DECISION 2.1 — Embedded-wallet / passkey provider

> Comparison table for your morning decision. Full analysis + PoC status:
> `EMBEDDED_WALLET_PROVIDERS.md` and `POC_WEB3AUTH.md`. Decision already leaning
> **Web3Auth** (confirmed earlier); this is the at-a-glance table incl. the
> passkey angle and our 5-chain (ETH/BTC/SOL/TRX/TON) requirement. Prices
> marked *(verify)* move — re-check before signing.

## The lens that decides it

Our tx builders (`lib/crypto/*`) already take **raw key bytes** and were PoC-
proven to sign TON (ed25519) + TRX (secp256k1) with an external key
(`web3auth-external-key.poc.test.ts`). So the only hard requirement on a
provider is: **expose raw signing on both secp256k1 (ETH/BTC/TRX) and ed25519
(SOL/TON)**. Providers that only ship EVM+Solana helpers can't reach TON/TRX/BTC.

## Comparison

| Provider | TON | TRON | SOL | Custody model | Telegram WebView | Passkey | Price *(verify)* |
|---|---|---|---|---|---|---|---|
| **Web3Auth** ✅ chosen | ✅ (ed25519 raw) | ✅ (secp256k1) | ✅ | Non-custodial MPC (Shamir; 2/3, user holds a share; 5/9 node net holds one) | **First-party TMA support + guide** | ✅ built-in | **Free ≤1,000 MAW, then $0.02/MAU** |
| **Turnkey** (fallback) | ✅ (ed25519 raw) | ✅ (chain-agnostic) | ✅ | Non-custodial TEE (AWS Nitro; full key enclave-bound, no shares) | Works (API) — no TMA-specific guide found | ✅ (passkey-native) | Tx/signing-based, quote needed |
| **Privy** (Stripe) | ❓ not advertised | ❓ | ✅ | Non-custodial embedded | Good web | ✅ | per-MAU *(verify)* |
| **Dynamic** | ❓ gaps | ❓ | ✅ | Non-custodial + MPC | Good web | ✅ | per-MAU *(verify)* |
| **Coinbase CDP** | ❌ | ❌ | ✅ | MPC (provider-operated shares) | verify | limited | per-MAU *(verify)* |

## Recommendation

**Web3Auth** for the Phase 2.1 beta: only provider with confirmed TON+TRON+SOL
via raw multi-curve signing **and** first-party Telegram Mini App support **and**
concrete cheap pricing (free at our tester scale), plus a custom-JWT verifier so
we keep Supabase auth. **Turnkey** is the fallback / later prod-hardening option
(cleaner TEE custody, but more to build and no TMA-specific path).

**Passkey note:** both Web3Auth and Turnkey support passkeys as a factor, but
passkeys inside Telegram's in-app WebView are constrained — plan for an
external-browser-tab fallback (already noted in the plan). Passkey is a factor
on top of the provider, not a provider itself.

## What's blocking a final commit (needs you)

1. Create the Web3Auth project (dashboard) → client ID + Supabase custom-JWT
   verifier. (Account creation is yours — I can't.)
2. Run the runtime PoC inside a real Telegram Mini App (device). Steps in
   `POC_WEB3AUTH.md`. If TON/TRX signing fails in the TMA runtime → stop.
3. Confirm the custody/share model in writing is acceptable as "non-custodial".

## Sources

- [Web3Auth pricing (free ≤1,000 MAW, $0.02/MAU)](https://web3auth.io/pricing.html)
- [Web3Auth MPC (Shamir shares, 5/9 network, 2/3 self-custodial)](https://web3auth.io/docs/features/mpc)
- [Web3Auth × Telegram Mini-Apps](https://blog.web3auth.io/unlock-the-power-of-telegram-mini-apps-with-web3auth/)
- [Turnkey review — TEE/AWS Nitro, chain-agnostic, non-custodial](https://cryptoadventure.com/turnkey-review-2026-embedded-wallet-infrastructure-key-control-and-the-real-custody-tradeoff/)
