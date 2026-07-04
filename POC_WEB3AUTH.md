# PoC — Web3Auth signing for Phase 2.1

> Isolated proof-of-concept. **Not** onboarding integration (that's deferred to
> the Phase 1 gate). Goal: verify the make-or-break — can we sign a real **TON
> (ed25519)** and **TRX (secp256k1)** transaction through our existing
> `lib/crypto` builders using a key from Web3Auth, inside a real Telegram Mini
> App? Status as of 2026-07-04.

## Result so far

**✅ Code-level make-or-break passes (offline).** Our signing is fully
decoupled from BIP39-seed derivation — the builders take **raw key bytes**:

- `sendTonRaw(tonPrivBytes)` / `tonAddressFromPrivKey(bytes)` → 32-byte ed25519
  seed via `@ton/crypto keyPairFromSeed`.
- `sendTrxRaw(privKey)` / `sendUsdtTrc20Raw(privKey)` → 32-byte secp256k1 key
  via `secp256k1.sign(hash, key, { lowS: true })`.

Proven in `__tests__/crypto/web3auth-external-key.poc.test.ts`: a random,
non-seed-derived key (standing in for what Web3Auth returns) produces a valid
TON address, a key model identical to standard ed25519, and verifiable TON and
TRX signatures. **So Web3Auth's key-reconstruction mode is a zero-change
drop-in for our signing code.**

## The one design choice this surfaces

Web3Auth offers two modes:

1. **Key-reconstruction** (SFA / Core Kit): the ed25519 / secp256k1 private key
   is reassembled **client-side in the browser** at sign time → we pass the raw
   bytes straight into `sendTonRaw` / `sendTrxRaw`. **No signing-code change.**
   Security posture ≈ today's model (raw key transiently in browser memory).
   **← recommended for the PoC/beta.**
2. **Threshold MPC (TSS)**: the full key is never reconstructed; you call a
   threshold signer. Our builders need the raw key, so this would require
   refactoring them to accept a **signer function** instead of key bytes — a
   custody-code change (off-limits without an explicit decision). Deferred; can
   be a later hardening step.

## Wiring recipe (for the runtime PoC — pseudocode, not committed)

```
// after Web3Auth login (custom-JWT verifier = our Supabase JWT)
const ed25519Key   = await web3auth.getEd25519Key();    // 32 bytes → TON
const secp256k1Key = await web3auth.getSecp256k1Key();  // 32 bytes → TRX
const tonAddr  = tonAddressFromPrivKey(ed25519Key);
const trxAddr  = tronAddressFromPrivKey(secp256k1Key);
await sendTonRaw(ed25519Key, toAddr, amount);   // existing builder, unchanged
await sendTrxRaw(secp256k1Key, toAddr, amount); // existing builder, unchanged
```

Keep Supabase auth: Web3Auth's **custom-JWT verifier** gates the key shares on
our existing Supabase session — no auth rework.

## What still needs Maksim (I cannot do these autonomously)

The runtime half of the PoC is blocked on things outside an agent's reach:

1. **Web3Auth account + client ID + verifier config** — requires signing up on
   the Web3Auth dashboard and configuring a custom-JWT verifier. Account
   creation isn't something I can (or should) do.
2. **Run inside a real Telegram Mini App** — the make-or-break "inside a real
   Telegram WebView" can only be validated on a device in Telegram; I can't
   operate Telegram's WebView (the browser tool is plain Chrome).
3. **Testnet broadcast** (optional) — needs funded TON/TRX testnet accounts.

## Runbook to finish the PoC (≈ half a day, when you're ready)

1. Create a Web3Auth project (dashboard) → get client ID; add a custom-JWT
   verifier pointing at Supabase (issuer/JWKS).
2. Spin up a **throwaway** Next.js route (not onboarding) that: logs in via
   Web3Auth using the Supabase JWT, reconstructs the ed25519 + secp256k1 keys,
   and calls `tonAddressFromPrivKey` / `tronAddressFromPrivKey` to show
   addresses.
3. Fund those addresses on **testnet**; call `sendTonRaw` / `sendTrxRaw` and
   confirm both txs broadcast + confirm.
4. Open that route **inside the Telegram Mini App** (via the bot) and repeat —
   confirm Web3Auth login works in the WebView (external-tab fallback if the
   social popup is blocked).
5. If TON or TRX signing fails in the TMA environment → **stop and report**; do
   not work around architectural limits.

## Boundaries respected

No Web3Auth SDK dependency added, no onboarding integration, no custody/signing
code changed. Only artifact: the offline feasibility test above. Real
integration waits for the Phase 1 gate.
