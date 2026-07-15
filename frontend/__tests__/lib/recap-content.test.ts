import { describe, it, expect } from 'vitest';
import {
  EMPTY_COUNTS,
  RECAP_EVENT_FIELD,
  RECAP_SOURCE_EVENTS,
  buildRecapSummary,
  hasActivity,
  isoWeekKey,
  type RecapCounts,
} from '@/lib/recap-content';

const counts = (over: Partial<RecapCounts> = {}): RecapCounts => ({ ...EMPTY_COUNTS, ...over });

describe('recap-content — activity gate', () => {
  it('empty week has no activity and yields no summary', () => {
    expect(hasActivity(EMPTY_COUNTS)).toBe(false);
    expect(buildRecapSummary(EMPTY_COUNTS, 'ru')).toBeNull();
    expect(buildRecapSummary(EMPTY_COUNTS, 'en')).toBeNull();
  });
  it('any single non-zero count counts as activity', () => {
    expect(hasActivity(counts({ aiUsed: 1 }))).toBe(true);
  });
});

describe('recap-content — summary is factual + safe', () => {
  it('lists only non-zero clauses (ru)', () => {
    const s = buildRecapSummary(counts({ sends: 3, risksFlagged: 1 }), 'ru')!;
    expect(s).toContain('3 перевода');
    expect(s).toContain('1 риск-проверка');
    expect(s).not.toMatch(/claim/i); // zero claims → not mentioned
    expect(s).not.toMatch(/Нейр/); // zero ai → not mentioned
  });
  it('lists only non-zero clauses (en)', () => {
    const s = buildRecapSummary(counts({ sends: 1, claimsSent: 2 }), 'en')!;
    expect(s).toContain('1 transfer sent');
    expect(s).toContain('2 claim links created');
    expect(s).not.toMatch(/risk/i);
  });
  it('never leaks amounts or addresses (only counts + neutral words)', () => {
    const s = buildRecapSummary(counts({ sends: 5, claimsReceived: 2, aiUsed: 4 }), 'ru')!;
    expect(s).not.toMatch(/0x[0-9a-f]/i); // no eth-style address
    expect(s).not.toMatch(/\$|USDT|USD|€|₽/); // no currency/amount tokens
  });
  it('uses correct russian plural forms', () => {
    expect(buildRecapSummary(counts({ sends: 1 }), 'ru')).toContain('1 перевод');
    expect(buildRecapSummary(counts({ sends: 2 }), 'ru')).toContain('2 перевода');
    expect(buildRecapSummary(counts({ sends: 5 }), 'ru')).toContain('5 переводов');
    expect(buildRecapSummary(counts({ sends: 21 }), 'ru')).toContain('21 перевод');
  });
});

describe('recap-content — event mapping', () => {
  it('every source event maps to a known counts field', () => {
    for (const ev of RECAP_SOURCE_EVENTS) {
      expect(EMPTY_COUNTS).toHaveProperty(RECAP_EVENT_FIELD[ev]);
    }
  });
  it('both AI events fold into aiUsed', () => {
    expect(RECAP_EVENT_FIELD.ai_chat_used).toBe('aiUsed');
    expect(RECAP_EVENT_FIELD.ai_explain_used).toBe('aiUsed');
  });
});

describe('recap-content — iso week dedupe key', () => {
  it('is stable within a week and changes across weeks', () => {
    const mon = Date.UTC(2026, 6, 13, 10, 0, 0); // Mon 2026-07-13
    const sun = Date.UTC(2026, 6, 19, 23, 0, 0); // Sun 2026-07-19 (same ISO week)
    const nextMon = Date.UTC(2026, 6, 20, 1, 0, 0); // Mon 2026-07-20 (next week)
    expect(isoWeekKey(mon)).toBe(isoWeekKey(sun));
    expect(isoWeekKey(mon)).not.toBe(isoWeekKey(nextMon));
    expect(isoWeekKey(mon)).toMatch(/^weekly_recap:\d{4}-W\d{2}$/);
  });
});
