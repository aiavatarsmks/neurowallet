/**
 * lib/referral.ts — pure, decision-neutral referral guards (задача 2.9).
 * No secrets, no network, no schema, no payout — safe on client and server,
 * fully testable. This is ONLY the anti-fraud + compliance gating logic that is
 * required under any reward design; reward medium/amounts and the DB schema are
 * product decisions (see DECISION_2.9) and are intentionally NOT here.
 *
 * The one non-negotiable rule encoded here: a referral can only ever be rewarded
 * AFTER a server-verified FUNDED action by the invitee — never for signup,
 * connect, or onboarding (CLAUDE.md + COMPLIANCE_TG.md). Everything else is an
 * anti-fraud guard on top of that.
 */

/** Referral lifecycle. Reward is possible ONLY from `funded`. */
export type ReferralStatus = 'pending' | 'funded' | 'rewarded' | 'rejected';

/** Format for a referral code: 6–12 upper-case base32-ish chars (no 0/O/1/I). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6,12}$/;

export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}
export function isValidReferralCode(raw: string): boolean {
  return CODE_RE.test(normalizeReferralCode(raw));
}

// ── Anti-fraud config (plan-grounded defaults; product tunes later) ──────────
export const MIN_TELEGRAM_ACCOUNT_AGE_DAYS = 14; // burner-account gate
export const MAX_REFERRALS_PER_WINDOW = 10;
export const REFERRAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Self-referral: inviter and invitee are the same user. Always rejected. */
export function isSelfReferral(referrerUserId: string, refereeUserId: string): boolean {
  return referrerUserId === refereeUserId;
}

/** Same device on both sides (by opaque device hash). Rejected. Empty ≠ match. */
export function isSameDevice(referrerDeviceHash: string, refereeDeviceHash: string): boolean {
  return !!referrerDeviceHash && referrerDeviceHash === refereeDeviceHash;
}

/** Invitee's Telegram account is too new to trust (velocity/burner gate). */
export function accountTooNew(accountAgeDays: number, minDays = MIN_TELEGRAM_ACCOUNT_AGE_DAYS): boolean {
  return !Number.isFinite(accountAgeDays) || accountAgeDays < minDays;
}

/** Referrer over their rate limit in the trailing window → throttle/review. */
export function exceedsVelocity(recentCount: number, maxPerWindow = MAX_REFERRALS_PER_WINDOW): boolean {
  return recentCount >= maxPerWindow;
}

export type RejectReason =
  | 'self_referral'
  | 'same_device'
  | 'account_too_new'
  | 'velocity_exceeded'
  | 'not_funded';

export interface ReferralCheckInput {
  referrerUserId: string;
  refereeUserId: string;
  referrerDeviceHash: string;
  refereeDeviceHash: string;
  refereeAccountAgeDays: number;
  referrerRecentCount: number;
}

/**
 * Run all anti-fraud guards for creating a referral link (before any reward).
 * Returns the first failing reason, or null if the referral may be recorded as
 * `pending`. Deny-by-default posture: any guard failing rejects.
 */
export function checkReferralEligibility(i: ReferralCheckInput): RejectReason | null {
  if (isSelfReferral(i.referrerUserId, i.refereeUserId)) return 'self_referral';
  if (isSameDevice(i.referrerDeviceHash, i.refereeDeviceHash)) return 'same_device';
  if (accountTooNew(i.refereeAccountAgeDays)) return 'account_too_new';
  if (exceedsVelocity(i.referrerRecentCount)) return 'velocity_exceeded';
  return null;
}

/**
 * THE compliance gate: may this referral be rewarded now? Only when a
 * server-verified funded action has moved it to `funded`. Never rewards a
 * `pending` (signup/connect) or an already-`rewarded`/`rejected` referral.
 */
export function canReward(status: ReferralStatus): boolean {
  return status === 'funded';
}

/** Feature flag. Off by default — no referral surface, no accrual. */
export function referralEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REFERRAL_ENABLED === 'true';
}
