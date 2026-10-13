# Task 04-backup-restore: restore keys from the 30-day device backup

## Why
Since the last release, deleting or replacing a wallet on the device first saves an encrypted copy of the key blobs to `localStorage['nw_wallet_backup_v1']` for 30 days (`lib/legacy-storage-cleanup.ts`). Nothing in the app can read it yet, so a user who reset by mistake cannot get the wallet back without the seed phrase.

## Requirements
1. In `SecurityCenter.tsx` (real mode only, never demo), when `readWalletBackup()` returns a non-expired backup, show a card «Резервная копия кошелька от <дата>» / "Wallet backup from <date>" with the backed-up ETH address shortened (first 6 + last 4) and a button «Восстановить» / "Restore".
2. Restore flow (inline steps, no window.confirm): ask for the wallet PASSWORD of that backup; verify it by decrypting one of the backup's encrypted blobs (same approach as `verifyWalletPassword` in `lib/pin.ts`, but against the backup's values, zeroing decrypted bytes); wrong password → error, nothing changes. On success: if a different wallet is currently on the device, show the existing «this will replace the current wallet» warning step (reuse the copy and logic from the onboarding replace flow) and back up the current wallet first (the backup slot holds one copy: swap the two, so the replaced wallet becomes the new backup); then write the backed-up keys back with the existing storage helpers, clear the PIN (the user sets a new one: reuse the PIN setup flow that `wallet.tsx` already forces when no PIN exists) and reload the wallet state.
3. Put the pure logic in `lib/legacy-storage-cleanup.ts` (keep that file free of imports, it is loaded in `_app`) or in a new small `lib/wallet-backup-restore.ts` that may import `lib/crypto/aes`. Never log or send any blob anywhere.
4. Tests: wrong password changes nothing; correct password restores exactly the backed-up keys; swap keeps the replaced wallet as the new backup; expired backup is not offered; demo mode never shows the card.

## Files
- `frontend/lib/legacy-storage-cleanup.ts`
- `frontend/lib/pin.ts`
- `frontend/lib/crypto/aes.ts`
- `frontend/components/SecurityCenter.tsx`
- `frontend/pages/wallet.tsx`
- `frontend/pages/onboarding.tsx`
- `frontend/lib/i18n.ts`

## Acceptance
All existing tests green; new tests cover the five cases above; no code path writes keys without a successful password check.
