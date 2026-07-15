import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

// Rows the mocked analytics query returns for aggregateWeek.
let analyticsRows: { event: string }[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        gte() { return Promise.resolve({ data: analyticsRows }); },
      };
      return chain;
    },
  }),
}));

const dispatchMock = vi.fn();
vi.mock('@/lib/server/notification-engine', () => ({
  dispatchNotification: (...args: unknown[]) => dispatchMock(...args),
}));

import { generateWeeklyRecap } from '@/lib/server/recap';

describe('generateWeeklyRecap — factual + deduped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyticsRows = [];
    dispatchMock.mockResolvedValue({ inbox: 'sent', telegram: 'skipped' });
  });

  it('empty week → status empty, nothing dispatched', async () => {
    const r = await generateWeeklyRecap({ userId: 'u1', nowMs: Date.UTC(2026, 6, 15) });
    expect(r.status).toBe('empty');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('counts real events and dispatches a weekly_recap with a safe summary + week dedupe', async () => {
    analyticsRows = [
      { event: 'send_succeeded' },
      { event: 'send_succeeded' },
      { event: 'risk_flagged' },
      { event: 'ai_chat_used' },
      { event: 'ai_explain_used' },
    ];
    const r = await generateWeeklyRecap({ userId: 'u1', lang: 'ru', nowMs: Date.UTC(2026, 6, 15) });
    expect(r.status).toBe('sent');
    expect(r.counts).toMatchObject({ sends: 2, risksFlagged: 1, aiUsed: 2 });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const arg = dispatchMock.mock.calls[0][0];
    expect(arg.kind).toBe('weekly_recap');
    expect(arg.dedupeKey).toMatch(/^weekly_recap:\d{4}-W\d{2}$/);
    expect(arg.meta.summary).toContain('2 перевода');
    expect(arg.meta.summary).not.toMatch(/0x|USDT|\$/); // no sensitive data
  });

  it('reports deduped when the engine deduped the inbox insert', async () => {
    analyticsRows = [{ event: 'send_succeeded' }];
    dispatchMock.mockResolvedValue({ inbox: 'deduped', telegram: 'skipped' });
    const r = await generateWeeklyRecap({ userId: 'u1', nowMs: Date.UTC(2026, 6, 15) });
    expect(r.status).toBe('deduped');
  });
});
