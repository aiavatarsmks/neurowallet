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

## ✅ Safe cores BUILT this session (flags OFF, tested — activate later)

After your go-ahead I built the decision-neutral core of every remaining task
that has one. All ship dark (flag OFF), need no account, move no money:

- **2.2 swap** — `lib/swap-quote.ts` (BigInt fee/slippage + `/api/swap/quote`
  proxy, 1inch adapter stubbed). Activate: add `ONEINCH_API_KEY` + confirm markup %.
- **2.3 on-ramp** — `lib/onramp-config.ts` (EU-first region gate + TON-first assets).
  Activate: pick provider + create account.
- **2.9 referral** — `lib/referral.ts` (anti-fraud guards + funded-only `canReward`).
  Activate: decide reward medium/amounts.
- **3.1 Policy Engine** — `lib/policy-engine.ts` (deterministic, deny-by-default;
  acceptance proven) + migration `0011_policies.sql` **APPLIED to prod** + CRUD
  API + permissions UI (ProfileScreen) + **wired into send-review behind flag
  `NEXT_PUBLIC_POLICY_ENGINE_ENABLED` (OFF)**. Flip that flag (Vercel) to activate;
  send flow is unchanged while OFF.
- **3.2 Tool Firewall + Action Proposals + Explainability** — `lib/tool-firewall.ts`,
  `lib/action-proposal.ts`. Full AI-safety moat assembled up to the signer.

## ⏭️ Still needs YOU (nothing else is safely autonomous)

1. **BotFather texts** — Telegram not logged in here. Texts finalized in
   `COMPLIANCE_TG.md`. ~2 min.
2. **Claim event-cycle verify** — tables empty; do a Mini App smoke then run
   `CLAIM_LINKS_VERIFY.md`.
3. ~~Apply migration 0011~~ — **DONE (applied to prod 2026-07-18)**.
4. **Enable the Policy Engine when ready:** set `NEXT_PUBLIC_POLICY_ENGINE_ENABLED=true`
   in Vercel + redeploy → the permissions screen appears (Profile) and sends are
   checked against your policies. Review the flow first; flag OFF = no change.
5. **Provider accounts/keys** (1inch, on-ramp, Web3Auth) + **product decisions**
   (swap markup %, referral reward, AI command set, premium pricing).
6. **2.1 key-custody migration** (CloudStorage) — fund-loss risk; supervised only.

## Also this session (all pushed)
Closed: 2.4 notification engine (+ never-throw hardening), 2.7 weekly AI recap,
all 2.10 code items. Cores: 2.2/2.3/2.9/3.1/3.2. Docs: SUPABASE_SCHEMA (0001–0011),
DECISION_2.2/2.3/2.9. **Test suite 207 → 309, tsc clean, `origin/main` synced.**
