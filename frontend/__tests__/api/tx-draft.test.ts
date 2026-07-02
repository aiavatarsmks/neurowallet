import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/tx-draft';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  draftInserts: [] as Array<Record<string, unknown>>,
  simInserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  updateReturns: [{ id: 'draft-1' }] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getTraceId: () => null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === 'tx_drafts') {
          state.draftInserts.push(row);
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: 'draft-1' }, error: null }) }),
          };
        }
        state.simInserts.push(row);
        return Promise.resolve({ error: null });
      },
      update: (row: Record<string, unknown>) => {
        state.updates.push(row);
        return { eq: () => ({ select: () => Promise.resolve({ data: state.updateReturns, error: null }) }) };
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const DRAFT_BODY = {
  coin: 'ETH',
  to_address: '0x' + 'a'.repeat(40),
  amount: 0.5,
  simulation: { status: 'ok', fee_native: 0.0003, fee_currency: 'ETH', fee_eur: 0.84, warnings: [] },
};

describe('/api/tx-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.draftInserts.length = 0;
    state.simInserts.length = 0;
    state.updates.length = 0;
    state.updateReturns = [{ id: 'draft-1' }];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: DRAFT_BODY }), res);
    expect(res.statusCode).toBe(401);
  });

  it('429 when rate limited', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: DRAFT_BODY }), res);
    expect(res.statusCode).toBe(429);
  });

  it('400 on unknown coin / bad amount / oversized address', async () => {
    for (const body of [
      { ...DRAFT_BODY, coin: 'DOGE' },
      { ...DRAFT_BODY, amount: -1 },
      { ...DRAFT_BODY, to_address: 'x'.repeat(200) },
    ]) {
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(state.draftInserts.length).toBe(0);
  });

  it('POST creates draft + simulation row; audit metadata carries NO address', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: DRAFT_BODY }), res);
    expect(res.statusCode).toBe(201);
    expect((res.jsonBody as { id: string }).id).toBe('draft-1');

    expect(state.draftInserts[0].to_address).toBe(DRAFT_BODY.to_address);
    expect(state.draftInserts[0].user_id).toBe('user-1');
    expect(state.simInserts[0].draft_id).toBe('draft-1');
    expect(state.simInserts[0].status).toBe('ok');

    // privacy: адрес и сумма не утекают в audit_log.metadata
    const auditMeta = mockedAudit.mock.calls[0][2] as Record<string, unknown>;
    expect(JSON.stringify(auditMeta)).not.toContain(DRAFT_BODY.to_address);
    expect(Object.keys(auditMeta).sort()).toEqual(['coin', 'draft_id']);
  });

  it('PATCH finalizes own draft; 404 when RLS hides someone else’s', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: '123e4567-e89b-42d3-a456-426614174000', status: 'sent', tx_hash: '0xdead' } }), res);
    expect(res.statusCode).toBe(200);
    expect(state.updates[0].status).toBe('sent');

    state.updateReturns = []; // RLS: чужая строка невидима → пустой результат
    const res2 = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: '123e4567-e89b-42d3-a456-426614174000', status: 'sent' } }), res2);
    expect(res2.statusCode).toBe(404);
  });
});
