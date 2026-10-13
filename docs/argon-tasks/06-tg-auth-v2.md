# Task 06-tg-auth-v2: Telegram login without a password derived from the bot token, behind a server flag

## Why
Today every Telegram account's Supabase password is HMAC(bot token, telegram id) (`pages/api/tg-auth.ts`). Consequences: (a) a leaked bot token unlocks every account; (b) rotating the token locks every user out; (c) anyone can pre-register `tg_<victim>@neurowallet.tg` by e-mail signup and break that user's login; (d) all logins are password sign-ins from Vercel IPs and can hit Supabase per-IP limits.

## Requirements
1. Server env flag `TG_AUTH_V2_ENABLED` (server-only, default OFF). OFF = exactly today's code path.
2. With the flag ON, after the existing initData HMAC + freshness check (keep it untouched):
   - Look the user up by e-mail `tg_<id>@neurowallet.tg` with the service-role admin API.
   - Not found → `auth.admin.createUser({ email, email_confirm: true, password: <32 random bytes, never stored or returned>, app_metadata: { telegram_id, source: 'telegram_mini_app' }, user_metadata: { name } })`.
   - Found and `app_metadata.telegram_id === tgUser.id` → OK.
   - Found but `app_metadata.telegram_id` missing (an account created before this change): try today's legacy password sign-in once; success proves it is the real owner → set app_metadata (existing helper `syncTelegramAppMetadata`) and continue. Failure → treat as squatted: refuse with 409 and write an audit event `tg_auth_conflict` (no PII beyond user ids).
   - Found with a DIFFERENT telegram_id → refuse 409 + audit.
   - Session: `auth.admin.generateLink({ type: 'magiclink', email })`, take `properties.hashed_token`, then `verifyOtp({ type: 'magiclink', token_hash })` on a server-side anon client to obtain the session; return the same response shape as today.
3. Provide `supabase/migrations/0014_block_tg_email_signup.sql` with a `before user created` auth hook function (plpgsql, SECURITY DEFINER, `SET search_path = ''`) that rejects sign-ups for `%@neurowallet.tg` unless `app_metadata->>'source' = 'telegram_mini_app'`, plus comments explaining that the hook must be enabled in Supabase Dashboard → Auth → Hooks and how to roll back. Do not change any other migration.
4. Tests (`__tests__/api/tg-auth-v2.test.ts`, mock the supabase-js client): new user, returning user, legacy user migrated, squatted account refused, different telegram id refused, flag OFF uses the old path, the random password never appears in responses or logs.
5. Update the security notes in the header of `tg-auth.ts` and the auth section of `API_SPEC.md` (Russian, no em dash).

## Files
- `frontend/pages/api/tg-auth.ts`
- `frontend/lib/server/telegram-id.ts`
- `frontend/lib/server/api-security.ts`
- `frontend/__tests__/api/tg-auth.test.ts`
- `supabase/migrations/0013_payment_requests_status_only.sql`
- `API_SPEC.md`

## Acceptance
Flag OFF: existing tg-auth tests pass untouched. Flag ON: all cases above covered by tests. Activation is an owner decision after a staging test.
