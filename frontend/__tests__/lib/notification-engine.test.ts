import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── env so svc()/writeNotification build a (mocked) client ───────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

// Audit is mocked out — engine behaviour under test is delivery/dedup/limits.
vi.mock('@/lib/server/api-security', () => ({ writeAuditLog: vi.fn() }));

interface FakeConfig {
  rules?: Record<string, unknown> | null;
  promoSent?: number; // promotional deliveries in window
  inboxAlreadySent?: boolean;
  telegramAlreadySent?: boolean;
  throwOnCount?: boolean; // simulate a deliveries count query rejecting
}

let cfg: FakeConfig = {};
const inserts: { table: string; row: Record<string, unknown> }[] = [];

// Minimal thenable Supabase query-builder stand-in.
function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  let isCount = false;
  const b: Record<string, unknown> = {
    select(_c: string, o?: { count?: string; head?: boolean }) {
      if (o?.count) isCount = true;
      return b;
    },
    eq(col: string, val: unknown) { filters[col] = val; return b; },
    gte() { return b; },
    insert(row: Record<string, unknown>) { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
    upsert() { return Promise.resolve({ error: null }); },
    maybeSingle() {
      if (table === 'notification_rules') return Promise.resolve({ data: cfg.rules ?? null });
      return Promise.resolve({ data: null });
    },
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      // awaited count query on notification_deliveries
      if (table === 'notification_deliveries' && isCount) {
        if (cfg.throwOnCount) return reject(new Error('db down'));
        if ('channel' in filters) {
          const already = filters.channel === 'inbox' ? cfg.inboxAlreadySent : cfg.telegramAlreadySent;
          return resolve({ count: already ? 1 : 0 });
        }
        if (filters.category === 'promotional') return resolve({ count: cfg.promoSent ?? 0 });
      }
      return resolve({ count: 0, data: null });
    },
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => makeBuilder(t) }),
}));

// import AFTER mocks
import { dispatchNotification } from '@/lib/server/notification-engine';
import { writeAuditLog } from '@/lib/server/api-security';

const mockedAudit = vi.mocked(writeAuditLog);
const deliveryRows = () => inserts.filter((i) => i.table === 'notification_deliveries').map((i) => i.row);

describe('notification engine — dispatch', () => {
  beforeEach(() => {
    cfg = {};
    inserts.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
  });

  it('delivers a transactional event to inbox by default (telegram off)', async () => {
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1' });
    expect(r.inbox).toBe('sent');
    expect(r.telegram).toBe('suppressed');
    // inbox insert into notifications happened, plus 2 delivery journal rows
    expect(inserts.some((i) => i.table === 'notifications')).toBe(true);
    const d = deliveryRows();
    expect(d.find((x) => x.channel === 'inbox')?.status).toBe('sent');
    expect(d.find((x) => x.channel === 'telegram')?.reason).toBe('channel_off');
  });

  it('suppresses inbox when the category is disabled', async () => {
    cfg.rules = { transactional_enabled: false };
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1' });
    expect(r.inbox).toBe('suppressed');
    expect(inserts.some((i) => i.table === 'notifications')).toBe(false);
    expect(deliveryRows().find((x) => x.channel === 'inbox')?.reason).toBe('category_off');
  });

  it('does not deliver a duplicate to inbox (dedup)', async () => {
    cfg.inboxAlreadySent = true;
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1' });
    expect(r.inbox).toBe('deduped');
    expect(inserts.some((i) => i.table === 'notifications')).toBe(false);
    expect(deliveryRows().find((x) => x.channel === 'inbox')?.status).toBe('deduped');
  });

  it('sends to telegram when opted in and delivers text', async () => {
    cfg.rules = { telegram_enabled: true, transactional_enabled: true };
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('sent');
    expect(fetch).toHaveBeenCalledOnce();
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.status).toBe('sent');
  });

  it('rate-limits promotional on telegram (≤ 2 / window)', async () => {
    cfg.rules = { telegram_enabled: true, promotional_enabled: true };
    cfg.promoSent = 2; // already at the cap
    const r = await dispatchNotification({ userId: 'u1', kind: 'weekly_recap', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('suppressed');
    expect(fetch).not.toHaveBeenCalled();
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.reason).toBe('rate_limited');
  });

  it('dedups a telegram delivery already sent', async () => {
    cfg.rules = { telegram_enabled: true, transactional_enabled: true };
    cfg.telegramAlreadySent = true;
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('deduped');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('suppresses telegram when opted in but no linked account (no telegramId)', async () => {
    cfg.rules = { telegram_enabled: true, transactional_enabled: true };
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1' });
    expect(r.telegram).toBe('suppressed');
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.reason).toBe('channel_off');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a telegram send failure as failed (fetch not ok)', async () => {
    cfg.rules = { telegram_enabled: true, transactional_enabled: true };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response));
    const r = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('skipped');
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.status).toBe('failed');
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.reason).toBe('error');
  });
});

describe('notification engine — audit of critical kinds', () => {
  beforeEach(() => {
    cfg = {};
    inserts.length = 0;
    mockedAudit.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
  });

  it('audits a critical kind that was delivered (req present)', async () => {
    await dispatchNotification({ userId: 'u1', kind: 'security_alert', dedupeKey: 'k1', req: {} as never });
    expect(mockedAudit).toHaveBeenCalledOnce();
    expect(mockedAudit.mock.calls[0][1]).toBe('notification_delivered');
  });

  it('does not audit a non-critical kind', async () => {
    await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1', req: {} as never });
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it('does not audit when nothing was actually delivered', async () => {
    cfg.rules = { transactional_enabled: false }; // security still delivers though...
    // use a suppressed critical kind: disable inbox via dedup + no telegram
    cfg.inboxAlreadySent = true;
    await dispatchNotification({ userId: 'u1', kind: 'claim_received', dedupeKey: 'k1', req: {} as never });
    expect(mockedAudit).not.toHaveBeenCalled();
  });
});

describe('notification engine — quiet hours (telegram)', () => {
  beforeEach(() => {
    cfg = {};
    inserts.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 3, 0, 0))); // 03:00 UTC
  });
  afterEach(() => vi.useRealTimers());

  it('suppresses a price alert during quiet hours', async () => {
    cfg.rules = { telegram_enabled: true, price_enabled: true, quiet_hours_enabled: true, quiet_start_min: 1320, quiet_end_min: 480, tz_offset_min: 0 };
    const r = await dispatchNotification({ userId: 'u1', kind: 'price_alert', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('suppressed');
    expect(deliveryRows().find((x) => x.channel === 'telegram')?.reason).toBe('quiet_hours');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('security alerts bypass quiet hours', async () => {
    cfg.rules = { telegram_enabled: true, quiet_hours_enabled: true, quiet_start_min: 1320, quiet_end_min: 480, tz_offset_min: 0 };
    const r = await dispatchNotification({ userId: 'u1', kind: 'security_alert', dedupeKey: 'k1', telegramId: 123 });
    expect(r.telegram).toBe('sent');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('notification engine — never throws (best-effort invariant)', () => {
  beforeEach(() => {
    cfg = {};
    inserts.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
  });

  it('does not throw when a deliveries count query rejects; inbox still delivered', async () => {
    cfg.throwOnCount = true; // both alreadySent and promoSentInWindow reject
    let result: Awaited<ReturnType<typeof dispatchNotification>> | undefined;
    await expect(
      (async () => {
        result = await dispatchNotification({ userId: 'u1', kind: 'tx_sent', dedupeKey: 'k1', telegramId: 123 });
      })(),
    ).resolves.toBeUndefined();
    // dedup pre-check failed open → inbox insert still attempted and succeeded
    expect(result?.inbox).toBe('sent');
    expect(inserts.some((i) => i.table === 'notifications')).toBe(true);
  });
});
