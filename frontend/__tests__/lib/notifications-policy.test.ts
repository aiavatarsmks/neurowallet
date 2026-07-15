import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RULES,
  categoryOf,
  categoryEnabled,
  decideInbox,
  decideTelegram,
  inQuietWindow,
  localMinutes,
  type NotificationRules,
} from '@/lib/notifications-config';

const rules = (over: Partial<NotificationRules> = {}): NotificationRules => ({ ...DEFAULT_RULES, ...over });

describe('notifications policy — kind→category', () => {
  it('maps kinds to the right category', () => {
    expect(categoryOf('tx_sent')).toBe('transactional');
    expect(categoryOf('tx_failed')).toBe('transactional');
    expect(categoryOf('claim_received')).toBe('transactional');
    expect(categoryOf('security_alert')).toBe('security');
    expect(categoryOf('price_alert')).toBe('price');
    expect(categoryOf('weekly_recap')).toBe('promotional');
  });
});

describe('notifications policy — category toggles', () => {
  it('security can never be disabled', () => {
    expect(categoryEnabled(rules({ securityEnabled: false }), 'security')).toBe(true);
  });
  it('other categories respect their toggle', () => {
    expect(categoryEnabled(rules({ transactionalEnabled: false }), 'transactional')).toBe(false);
    expect(categoryEnabled(rules({ priceEnabled: false }), 'price')).toBe(false);
    expect(categoryEnabled(rules({ promotionalEnabled: false }), 'promotional')).toBe(false);
  });
});

describe('notifications policy — inbox', () => {
  it('delivers when the category is on', () => {
    expect(decideInbox(rules(), 'transactional')).toEqual({ deliver: true, reason: 'ok' });
  });
  it('suppresses a disabled category', () => {
    expect(decideInbox(rules({ priceEnabled: false }), 'price')).toEqual({ deliver: false, reason: 'category_off' });
  });
});

describe('notifications policy — telegram', () => {
  it('is off unless opted in', () => {
    expect(decideTelegram(rules(), 'transactional', Date.now())).toEqual({ deliver: false, reason: 'channel_off' });
  });
  it('delivers when opted in and category on', () => {
    expect(decideTelegram(rules({ telegramEnabled: true }), 'transactional', Date.now())).toEqual({ deliver: true, reason: 'ok' });
  });
  it('suppresses during quiet hours', () => {
    // Quiet 22:00→08:00 UTC, "now" = 03:00 UTC → inside window.
    const now = Date.UTC(2026, 0, 1, 3, 0, 0);
    const r = rules({ telegramEnabled: true, quietHoursEnabled: true, quietStartMin: 1320, quietEndMin: 480, tzOffsetMin: 0 });
    expect(decideTelegram(r, 'price', now)).toEqual({ deliver: false, reason: 'quiet_hours' });
  });
  it('security bypasses quiet hours', () => {
    const now = Date.UTC(2026, 0, 1, 3, 0, 0);
    const r = rules({ telegramEnabled: true, quietHoursEnabled: true, quietStartMin: 1320, quietEndMin: 480 });
    expect(decideTelegram(r, 'security', now)).toEqual({ deliver: true, reason: 'ok' });
  });
  it('delivers outside quiet hours', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0); // noon
    const r = rules({ telegramEnabled: true, quietHoursEnabled: true, quietStartMin: 1320, quietEndMin: 480 });
    expect(decideTelegram(r, 'price', now)).toEqual({ deliver: true, reason: 'ok' });
  });
});

describe('notifications policy — quiet window math', () => {
  it('handles wrap-around past midnight', () => {
    expect(inQuietWindow(23 * 60, 1320, 480)).toBe(true); // 23:00 in 22:00→08:00
    expect(inQuietWindow(3 * 60, 1320, 480)).toBe(true); // 03:00 in 22:00→08:00
    expect(inQuietWindow(12 * 60, 1320, 480)).toBe(false); // 12:00 outside
  });
  it('handles a same-day window', () => {
    expect(inQuietWindow(10 * 60, 540, 720)).toBe(true); // 10:00 in 09:00→12:00
    expect(inQuietWindow(13 * 60, 540, 720)).toBe(false);
  });
  it('empty window is never quiet', () => {
    expect(inQuietWindow(600, 600, 600)).toBe(false);
  });
  it('applies the tz offset to local minutes', () => {
    // 03:00 UTC with +180min (UTC+3) → 06:00 local.
    expect(localMinutes(Date.UTC(2026, 0, 1, 3, 0, 0), 180)).toBe(6 * 60);
    // 01:00 UTC with -120min (UTC-2) → 23:00 previous local day.
    expect(localMinutes(Date.UTC(2026, 0, 1, 1, 0, 0), -120)).toBe(23 * 60);
  });
});
