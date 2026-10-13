# Task 02-ton-memo: TON and USDT-TON comment (memo) for exchange deposits, behind a flag

## Why
Exchanges (Bybit, Binance, OKX) require a memo/comment for TON and USDT-TON deposits. Without it deposits get lost or stuck. Today the send screen only warns that memo is not supported.

## Requirements
1. Flag `NEXT_PUBLIC_TON_MEMO_ENABLED` (default OFF, read like the other `NEXT_PUBLIC_*_ENABLED` flags). With the flag OFF everything stays exactly as now, including the existing warning.
2. `frontend/lib/crypto/ton-tx.ts`: `sendTonRaw` and `sendUsdtTonRaw` accept an optional `comment?: string`.
   - Native TON: message body = text comment cell (32-bit op 0 followed by the UTF-8 text; use `@ton/core` `beginCell().storeUint(0, 32).storeStringTail(comment)` or the library's `comment()` helper).
   - USDT-TON jetton transfer (TEP-74): put the comment into `forward_payload` (as an Either-ref cell with op 0 + text) and set `forward_ton_amount` to 1 nanoton (0.000000001 TON) so the receiver gets `transfer_notification` with the comment (that is what exchanges read). Make sure the TON attached to the jetton transfer still covers fees plus the forward amount; read the existing amounts in the code and keep them unless they must grow (explain in risks).
   - Validate: comment trimmed, max 120 characters (bytes after UTF-8 encoding ≤ 120), no control characters; otherwise throw a clear error before decrypting keys.
   - Keep the zeroization in `finally` blocks exactly as it is.
3. `frontend/lib/crypto/transactions.ts`: the public `sendTon` / `sendUsdtTon` wrappers pass the optional comment through.
4. `frontend/components/CryptoSendScreen.tsx`: when the flag is ON and the coin is TON or USDT_TON, show an optional input «Комментарий (мемо)» / "Comment (memo)" under the address field with a hint «Нужен для депозита на биржу: скопируйте мемо с биржи» / "Required for exchange deposits: copy the memo from the exchange"; show it on the review card; pass it to the send function; replace the "memo is not supported" warning with the input. With the flag OFF the old warning stays.
5. Tests (`__tests__/crypto/ton-memo.test.ts`, node environment): build the native and jetton message cells with a comment and parse them back with `@ton/core` (`beginParse`, load op 0 and the string), check `forward_ton_amount` = 1 nanoton and that the transfer without a comment is byte-identical to today's (golden check against the current builder). UI test: flag OFF shows the old warning and no input; flag ON shows the input and passes the comment to the mocked send function.

## Files
- `frontend/lib/crypto/ton-tx.ts`
- `frontend/lib/crypto/transactions.ts`
- `frontend/components/CryptoSendScreen.tsx`
- `frontend/lib/ton-mnemonic-config.ts`
- `frontend/lib/i18n.ts`
- `frontend/__tests__/send-private-note.test.tsx`

## Acceptance
Flag OFF: zero behaviour change (existing tests pass untouched). Flag ON: comment round-trips through the real `@ton/core` cell builder in tests. Activation in production stays an owner decision after one real test deposit to an exchange.
