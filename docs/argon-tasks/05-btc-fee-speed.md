# Task 05-btc-fee-speed: choose BTC fee speed on the review screen, behind a flag

## Why
BTC always uses mempool.space `hourFee`. When fees spike, a transfer can wait for hours, and users retry (double payment risk). Let the user choose the speed before signing.

## Requirements
1. Flag `NEXT_PUBLIC_BTC_FEE_CHOICE_ENABLED` (default OFF; OFF = today's behaviour, hourFee).
2. `frontend/lib/crypto/btc-tx.ts`: new `getBtcFeeRates()` returning `{slow: economyFee or hourFee, normal: hourFee, fast: fastestFee}` from `https://mempool.space/api/v1/fees/recommended` (one request, numbers validated, each at least 2 and each passed through the existing cap logic `assertBtcFeeRate` / `BTC_MAX_FEE_RATE_SAT_VB`); on failure fall back to the current single-rate behaviour.
3. `simulate.ts` (BTC section only): accept an optional chosen speed; the reviewed fee uses that rate, and `btcFeeRateSatVb` in the result is that rate (it is already passed to `sendBtc`, keep that contract).
4. `CryptoSendScreen.tsx`: when the flag is ON and coin is BTC, the review card shows three options «Медленно · Обычно · Быстро» / "Slow · Normal · Fast" with the fee in BTC and EUR for each; changing it re-runs the BTC fee estimate (no new network call per click if rates are cached for 60 s); the signed transaction uses exactly the reviewed rate. Default selection = Normal.
5. Do NOT add RBF (owner decision).
6. Tests: rate parsing, caps, fallback, simulate with each speed, UI selection passes the right `btcFeeRateSatVb` to the mocked `sendBtc`, flag OFF identical.

## Files
- `frontend/lib/crypto/btc-tx.ts`
- `frontend/lib/crypto/simulate.ts`
- `frontend/components/CryptoSendScreen.tsx`
- `frontend/lib/i18n.ts`
- `frontend/__tests__/crypto/btc-tx.test.ts`

## Acceptance
Flag OFF: no change. Flag ON: the fee the user saw is the fee that gets signed, always within the caps.
