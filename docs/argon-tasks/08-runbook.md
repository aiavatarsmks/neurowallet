# Task 08-runbook: RUNBOOK.md for incidents (Russian)

## Why
`CLAUDE.md` requires a runbook before production. There is none. The owner is not an engineer: steps must be concrete and short.

## Requirements
Write `RUNBOOK.md` in Russian, plain language, short numbered steps, no em dash character. Base every statement on the files below; where something is unknown, write it as an open question instead of inventing it. Sections:
1. Где смотреть, что всё живо: `/api/health`, GitHub Actions «Chain health» (daily live check), Vercel logs (`[client-error]`, `[csp-report]`, `[tg-auth]`, `[sol-rpc]`).
2. Умер провайдер сети (ETH/SOL/TON/TRON/BTC/курсы): how it shows up for users (the «не удалось обновить» line), which file holds the endpoint list, how the fallbacks work, what to change, how to verify with the live test.
3. Пользователь пишет «перевод пропал» или «перевод ушёл дважды»: how to find the transaction by hash per chain (explorers), what the in-app status means, the «результат неизвестен» state, what never to advise (resending).
4. Утечка токена Telegram-бота или ключа OpenRouter/Supabase service role: what to rotate where and the consequences (rotating the bot token today changes every Telegram user's Supabase password: users get locked out until tg-auth v2; say so plainly).
5. Пользователь потерял доступ: PIN забыт (password resets it), пароль забыт (seed phrase), ключи стёрлись (seed phrase, or the 30-day device backup), never ask users for their seed phrase.
6. Откат релиза: Vercel → previous deployment → Promote; feature flags (`NEXT_PUBLIC_*_ENABLED`) to switch features off; note that NEXT_PUBLIC values need a redeploy.
7. Supabase: where migrations live, applying and rolling back (each migration has a ROLLBACK block).
8. Контакты и доступы: a table to fill in (who has access to Vercel, Supabase, IONOS DNS, BotFather, GCP), left with blanks.

## Files
- `README.md`
- `API_SPEC.md`
- `PROD_READINESS_PLAN.md`
- `KEY_MANAGEMENT.md`
- `frontend/pages/api/health.ts`
- `frontend/pages/api/tg-auth.ts`
- `frontend/lib/crypto/eth-provider.ts`
- `frontend/lib/crypto/sol-rpc.ts`
- `frontend/lib/crypto/tx-status.ts`
- `.github/workflows/chain-health.yml`

## Acceptance
Every command, file name and URL in the runbook exists in the repository; nothing is invented; Russian text without the em dash.
