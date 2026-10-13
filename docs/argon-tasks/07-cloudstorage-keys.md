# Task 07-cloudstorage-keys: keep encrypted key blobs in Telegram CloudStorage, behind a flag

## Why
Inside Telegram the app's localStorage can be wiped between restarts. Then the encrypted keys disappear and the user must restore from the seed phrase (observed: "PIN not set" + "wrong password"). `IMPLEMENTATION_PLAN.md` section 2.1 (Interim) has the agreed design; read it carefully. The blobs stay encrypted (AES-GCM + PBKDF2 / scrypt keystore), so Telegram cannot read them: the wallet stays non-custodial.

## Requirements (follow the plan's design)
1. Flag `NEXT_PUBLIC_TG_CLOUD_KEYS_ENABLED` (default OFF; OFF = no change at all). Only active inside Telegram with `CloudStorage` available (Bot API 6.9+); otherwise plain localStorage as today.
2. New module `frontend/lib/key-store.ts`: CloudStorage is the source of truth, localStorage a synchronous cache. `hydrateKeyStore()` on start loads every wallet key from CloudStorage into localStorage (async, with a timeout), and exposes a ready state; write-through helpers used by the existing write sites (`saveWalletToStorage` in `lib/crypto/wallet.ts`, the onboarding writes, `setupPin`/`clearPin`, the delete/replace helpers in `lib/legacy-storage-cleanup.ts`). The ~67 synchronous read sites are NOT changed.
3. Migration both ways: if localStorage has the keys and CloudStorage does not → upload, read back and compare every value, only then mark `nw_cloud_keys_migrated_v1`; if localStorage lost them but CloudStorage has them → restore. Write keystore and encrypted blobs first, flags and addresses last. On any mismatch keep localStorage as the fallback and do not mark migrated.
4. The PIN gate in `pages/wallet.tsx` already starts fail-closed ('checking'): extend it to wait for hydration (with a timeout fallback to localStorage) so no screen reads keys before hydration ends.
5. Respect CloudStorage limits (4096 chars per value, 1024 keys); refuse to write a value that is too long and keep it local.
6. Telegram API calls are callback based: wrap them in promises with timeouts; never throw into React render.
7. Tests with a fake `window.Telegram.WebApp.CloudStorage`: hydration restores wiped localStorage; migration uploads and verifies; partial write does not mark migrated; flag OFF never touches CloudStorage; delete/replace remove keys in both places; outside Telegram nothing changes.

## Files
- `IMPLEMENTATION_PLAN.md`
- `KEY_MANAGEMENT.md`
- `frontend/hooks/useTelegram.ts`
- `frontend/lib/crypto/wallet.ts`
- `frontend/lib/pin.ts`
- `frontend/lib/legacy-storage-cleanup.ts`
- `frontend/pages/wallet.tsx`
- `frontend/pages/onboarding.tsx`

## Acceptance
Flag OFF: byte-identical behaviour, all existing tests green. Flag ON: the seven test scenarios pass. This changes the threat model (encrypted blobs on Telegram servers): activation is an owner decision, document it in `KEY_MANAGEMENT.md`.
