# Night activation log — 2026-07-18

Production changes made autonomously while you were asleep, with your explicit
go-ahead. All are reversible. Recorded here for review.

## ✅ Done (production)

### Vercel (project `neurowallet-frontend`, team `neuro-wallet`)
- Added env var **`NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED=true`** — Production + Preview.
- Added env var **`NEXT_PUBLIC_WEEKLY_RECAP_ENABLED=true`** — Production + Preview.
  - Both marked "Sensitive" in the UI (cosmetic; `NEXT_PUBLIC_*` are in the client
    bundle regardless). Existing `NEXT_PUBLIC_CLAIM_LINKS_ENABLED` is plain — if you
    want these plain too, toggle Sensitive off; no functional difference.
- **Redeployed Production** (fresh build so the new `NEXT_PUBLIC_*` values inline).
  Deployment status: **Ready** (commit `e51d6f2`, `docs(2.10): mark TON-native copy done`).
- **Verified live:** `neurowallet.tech` home shows TON-native asset order
  (TON, USDT_TON before BTC) — confirms 2.10 code + the redeploy are serving.

### Supabase (project `jraysrewevsbbxtqnggz` = NeuroWallet, main/PRODUCTION)
- Applied **migration `0010_notification_engine.sql`** in the SQL Editor
  (additive/idempotent). "Success. No rows returned."
- **Verified RLS** on all relevant tables:
  | table | rls_enabled | policies |
  |---|---|---|
  | notification_rules | true | 1 (select_own) |
  | notification_deliveries | true | 1 (select_own) |
  | claim_links | true | 1 |
  | claim_events | true | 0 (deny-all to clients; service-role reads only — by design) |
  | notifications | true | 1 |

## ⏭️ Blocked / needs you (I could not do these)

1. **BotFather texts** — Telegram Web is NOT logged in here (QR/phone-auth
   screen). I can't and won't do phone/QR authentication. Ready-to-paste RU/EN
   About + Description are in `COMPLIANCE_TG.md`. ~2 min for you via
   `@BotFather → /mybots → NeuroWallet_bot → Edit`.
2. **Claim-links event-cycle verify** — `claim_links`/`claim_events` are empty
   (0 rows), so there's no cycle to show yet. Do a Mini App smoke (create a
   claim link → open → claim), then run the queries in `CLAIM_LINKS_VERIFY.md`
   with that ref. RLS half of that verify is already ✅ (above).

## Remaining Phase 2 (2.1 / 2.3 / 2.2 / 2.9) — all blocked on YOUR decisions

None can be implemented autonomously — each needs a **provider account / API key
(I'm not allowed to create accounts)** and/or a **product/pricing decision**:

- **2.1** (Web3Auth) — needs Web3Auth account + Supabase JWT verifier + a device
  Telegram PoC. See `DECISION_2.1.md` / `POC_WEB3AUTH.md`.
- **2.2** (1inch swap) — needs 1inch API key + fee-% decision + scope (EVM+SOL+TON
  vs BTC). See `DECISION_2.2.md`.
- **2.3** (on-ramp) — decision framework drafted tonight: **`DECISION_2.3.md`**.
- **2.9** (referral) — decision framework drafted tonight: **`DECISION_2.9.md`**.

I did NOT write speculative code for these (would presuppose vendor choices and
risk throwaway/vendor-locked code, and 2.1 touches key custody = fund-loss risk).
Each decision doc lists the safe, flag-gated scaffolding I *can* build on your OK.

## Also this session (already pushed earlier)
Closed & pushed: 2.4 notification engine (+ never-throw hardening), 2.7 weekly AI
recap, all 2.10 code items (Receive→TON, TON-first home, TON-native copy, privacy
provider fix), aes/pin tests. Test suite 207 → 248, tsc clean, `origin/main` synced.
