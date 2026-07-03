import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/contacts';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: 0,
  mutationReturns: [{ id: 'contact-1' }] as Array<Record<string, unknown>>,
  listError: null as { message: string } | null,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: state.rows, error: state.listError }),
          }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        state.upserts.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: state.mutationReturns[0] ?? null, error: state.mutationReturns[0] ? null : { message: 'x' } }) }) };
      },
      update: (row: Record<string, unknown>) => {
        state.updates.push(row);
        return { eq: () => ({ select: () => Promise.resolve({ data: state.mutationReturns, error: null }) }) };
      },
      delete: () => {
        state.deletes += 1;
        return { eq: () => ({ select: () => Promise.resolve({ data: state.mutationReturns, error: null }) }) };
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const CONTACT = { name: 'Макс', coin: 'ETH', address: '0x' + 'a'.repeat(40) };
const CONTACT_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('/api/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [];
    state.upserts.length = 0;
    state.updates.length = 0;
    state.deletes = 0;
    state.mutationReturns = [{ id: 'contact-1' }];
    state.listError = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('GET degrades to empty list before migration 0005', async () => {
    state.listError = { message: 'relation "contacts" does not exist' };
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { contacts: unknown[] }).contacts).toEqual([]);
  });

  it('POST validates and upserts; audit carries only contact_id + coin', async () => {
    for (const bad of [
      { ...CONTACT, name: '' },
      { ...CONTACT, coin: 'DOGE' },
      { ...CONTACT, address: '' },
      { ...CONTACT, neuro_id: 'not-a-neuro-id' },
    ]) {
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body: bad }), res);
      expect(res.statusCode).toBe(400);
    }

    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ...CONTACT, neuro_id: 'nw-abcdef123456' } }), res);
    expect(res.statusCode).toBe(201);
    expect(state.upserts[0].user_id).toBe('user-1');
    const auditMeta = mockedAudit.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(auditMeta).sort()).toEqual(['coin', 'contact_id']);
    expect(JSON.stringify(auditMeta)).not.toContain(CONTACT.address);
  });

  it('PATCH toggles favorite; 404 on foreign contact (RLS empty)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: CONTACT_UUID, is_favorite: true } }), res);
    expect(res.statusCode).toBe(200);
    expect(state.updates[0].is_favorite).toBe(true);

    state.mutationReturns = [];
    const res2 = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: CONTACT_UUID, is_favorite: false } }), res2);
    expect(res2.statusCode).toBe(404);
  });

  it('DELETE removes own contact and audits', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'DELETE', body: { id: CONTACT_UUID } }), res);
    expect(res.statusCode).toBe(200);
    expect(state.deletes).toBe(1);
    expect(mockedAudit.mock.calls[0][1]).toBe('contact_deleted');
  });
});
