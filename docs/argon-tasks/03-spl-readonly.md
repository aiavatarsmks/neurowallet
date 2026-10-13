# Task 03-spl-readonly: show USDT and USDC on Solana (read-only), behind a flag

## Why
A user who receives USDT or USDC on Solana sees nothing today (only a warning on the receive screen). The funds are safe (Phantom-compatible derivation) but invisible. First step: show the balances read-only; sending SPL tokens is a later task.

## Requirements
1. Flag `NEXT_PUBLIC_SPL_READONLY_ENABLED` (default OFF). OFF = no change at all.
2. `frontend/lib/crypto/balances.ts`: new exported `fetchSplBalances(owner)` using the existing `solRpc` (`frontend/lib/crypto/sol-rpc.ts`, method `getTokenAccountsByOwner` is already allowed) with `{ mint }` filter and `{ encoding: 'jsonParsed' }`, for the mints USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` and USDC `EPjFWdd5AufqSSqeM1qvp4xkcrd9yHqf6ZkWQ6bJWdUh`. Sum `uiAmountString` (parse as decimal string, never float math on raw amounts) across token accounts; no accounts = 0; any provider failure rejects (the asset is then reported unavailable, never a fake 0). When the flag is ON, `fetchRealBalances` returns additive optional fields `splUsdt?: number`, `splUsdc?: number` and lists `SPL_USDT` / `SPL_USDC` in `unavailable` on failure (extend the type minimally and keep all existing consumers compiling).
3. Totals: USDT on Solana counts at the USDT price; USDC at `1 / usdPerEur` EUR when `usdPerEur` is known, else at the USDT price (state this in a code comment). Include both in `totalPortfolioEur` only when the flag is ON.
4. UI: `WalletScreen.tsx` shows, under the SOL row and only when the flag is ON and a balance is > 0 or unavailable, a compact sub-list «Токены Solana: USDT 12.5, USDC 3» / "Solana tokens: …" with a note «Отправка этих токенов скоро» / "Sending these tokens is coming soon". `ReceiveScreen.tsx`: when the flag is ON, change the SOL note to say USDT/USDC on Solana are shown but cannot be sent yet.
5. Tests: `fetchSplBalances` with mocked `solRpc` (several token accounts, none, malformed, failure → reject), totals with and without usdPerEur, flag OFF = identical `fetchRealBalances` output keys as today.

## Files
- `frontend/lib/crypto/balances.ts`
- `frontend/lib/crypto/sol-rpc.ts`
- `frontend/lib/crypto/assets.ts`
- `frontend/components/WalletScreen.tsx`
- `frontend/components/ReceiveScreen.tsx`
- `frontend/lib/i18n.ts`
- `frontend/__tests__/crypto/balances-honest.test.ts`

## Acceptance
Flag OFF: byte-identical behaviour, all existing tests green. Flag ON: balances shown read-only, failures shown as unavailable, never as 0.
