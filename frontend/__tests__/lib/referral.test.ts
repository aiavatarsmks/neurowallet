import { describe, it, expect } from 'vitest';
import {
  isValidReferralCode, normalizeReferralCode,
  isSelfReferral, isSameDevice, accountTooNew, exceedsVelocity,
  checkReferralEligibility, canReward, type ReferralCheckInput,
} from '@/lib/referral';

const ok = (over: Partial<ReferralCheckInput> = {}): ReferralCheckInput => ({
  referrerUserId: 'A', refereeUserId: 'B',
  referrerDeviceHash: 'dev-a', refereeDeviceHash: 'dev-b',
  refereeAccountAgeDays: 90, referrerRecentCount: 0, ...over,
});

describe('referral — code format', () => {
  it('accepts valid codes (no ambiguous chars), normalizes case', () => {
    expect(isValidReferralCode('abcd23')).toBe(true);
    expect(normalizeReferralCode(' abcd23 ')).toBe('ABCD23');
  });
  it('rejects ambiguous chars, wrong length', () => {
    expect(isValidReferralCode('ABCD0O')).toBe(false); // 0/O excluded
    expect(isValidReferralCode('ABC')).toBe(false); // too short
    expect(isValidReferralCode('A'.repeat(13))).toBe(false); // too long
  });
});

describe('referral — individual guards', () => {
  it('self-referral', () => {
    expect(isSelfReferral('U', 'U')).toBe(true);
    expect(isSelfReferral('U', 'V')).toBe(false);
  });
  it('same-device (empty never matches)', () => {
    expect(isSameDevice('h', 'h')).toBe(true);
    expect(isSameDevice('', '')).toBe(false);
    expect(isSameDevice('h', 'k')).toBe(false);
  });
  it('account-too-new', () => {
    expect(accountTooNew(5)).toBe(true); // < 14d default
    expect(accountTooNew(30)).toBe(false);
    expect(accountTooNew(NaN)).toBe(true); // unknown → too new
  });
  it('velocity', () => {
    expect(exceedsVelocity(10)).toBe(true); // >= 10 default
    expect(exceedsVelocity(9)).toBe(false);
  });
});

describe('referral — combined eligibility (deny by default)', () => {
  it('passes a clean referral', () => {
    expect(checkReferralEligibility(ok())).toBeNull();
  });
  it('returns the first failing reason', () => {
    expect(checkReferralEligibility(ok({ refereeUserId: 'A' }))).toBe('self_referral');
    expect(checkReferralEligibility(ok({ refereeDeviceHash: 'dev-a' }))).toBe('same_device');
    expect(checkReferralEligibility(ok({ refereeAccountAgeDays: 2 }))).toBe('account_too_new');
    expect(checkReferralEligibility(ok({ referrerRecentCount: 25 }))).toBe('velocity_exceeded');
  });
});

describe('referral — funded-only reward gate (compliance)', () => {
  it('rewards ONLY a funded referral', () => {
    expect(canReward('funded')).toBe(true);
    expect(canReward('pending')).toBe(false); // never for signup/connect
    expect(canReward('rewarded')).toBe(false);
    expect(canReward('rejected')).toBe(false);
  });
});
