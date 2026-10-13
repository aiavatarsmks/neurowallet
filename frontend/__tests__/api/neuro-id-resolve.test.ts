import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => {
  // lib/neuro-id → lib/supabase throws at import without these.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  return {
    clientKeys: [] as string[],
    select: '',
    eq: [] as unknown[],
    row: null as Record<string, unknown> | null,
    error: null as null | { message: string },
  };
});

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    state.clientKeys.push(key);
    return {
      from: () => ({
        select: (cols: string) => {
          state.select = cols;
          return {
            eq: (...args: unknown[]) => {
              state.eq = args;
              return { maybeSingle: () => Promise.resolve({ data: state.row, error: state.error }) };
            },
          };
        },
      }),
    };
  },
}));

const { default: handler } = await import('@/pages/api/neuro-id/resolve');

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const OWNER_UID = '4373edef-c4df-48ef-bf34-beaeb6f36c4a';
const OWNER_NID = 'nw-4373edefc4df';

function resolveReq(neuroId: string, coin = 'ETH') {
  return mockReq({ method: 'GET', query: { neuro_id: neuroId, coin }, headers: { authorization: 'Bearer user-jwt' } });
}

describe('GET /api/neuro-id/resolve (private directory, service-role lookup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.clientKeys.length = 0;
    state.select = '';
    state.eq = [];
    state.error = null;
    state.row = { user_id: OWNER_UID, neuro_id: OWNER_NID, display_name: 'Alice', eth_address: '0xE' };
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    mockedAuth.mockResolvedValue({ user: { id: 'caller' }, token: 'user-jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(resolveReq(OWNER_NID), res);
    expect(res.statusCode).toBe(401);
  });

  it('looks up ONE exact neuro_id with the service role and selects only the coin column', async () => {
    const res = mockRes();
    await handler(resolveReq(OWNER_NID, 'TRC20'), res);
    expect(state.clientKeys).toContain('service-test');
    expect(state.clientKeys).not.toContain('anon-test');
    expect(state.eq).toEqual(['neuro_id', OWNER_NID]);
    expect(state.select).toBe('user_id, neuro_id, display_name, tron_address');
  });

  it('returns only neuro_id, display_name and the one address (no user_id, no other chains)', async () => {
    state.row = { ...state.row, sol_address: 'SOL-LEAK' };
    const res = mockRes();
    await handler(resolveReq(OWNER_NID, 'ETH'), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({
      neuro_id: OWNER_NID,
      display_name: 'Alice',
      coin: 'ETH',
      address: '0xE',
      internal: true,
      settlement: 'onchain',
    });
    expect(JSON.stringify(res.jsonBody)).not.toContain(OWNER_UID);
    expect(JSON.stringify(res.jsonBody)).not.toContain('SOL-LEAK');
    expect(mockedAudit).toHaveBeenCalledWith('caller', 'neuro_id_resolved', { neuro_id: OWNER_NID, coin: 'ETH' }, expect.anything());
  });

  it('404 for an impersonation row (neuro_id not derived from its user_id)', async () => {
    state.row = { user_id: '2f58557a-78c6-4720-bd87-ac18baf62790', neuro_id: OWNER_NID, display_name: 'Alice', eth_address: '0xATTACKER' };
    const res = mockRes();
    await handler(resolveReq(OWNER_NID), res);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.jsonBody)).not.toContain('0xATTACKER');
  });

  it('404 when not found or no address for that coin', async () => {
    state.row = null;
    let res = mockRes();
    await handler(resolveReq(OWNER_NID), res);
    expect(res.statusCode).toBe(404);

    state.row = { user_id: OWNER_UID, neuro_id: OWNER_NID, display_name: 'Alice', btc_address: null };
    res = mockRes();
    await handler(resolveReq(OWNER_NID, 'BTC'), res);
    expect(res.statusCode).toBe(404);
  });

  it('400 on malformed id / coin, 503 without the service key (fail closed, no JWT fallback)', async () => {
    let res = mockRes();
    await handler(resolveReq('nw-<script>'), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await handler(resolveReq(OWNER_NID, 'DOGE'), res);
    expect(res.statusCode).toBe(400);

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    res = mockRes();
    await handler(resolveReq(OWNER_NID), res);
    expect(res.statusCode).toBe(503);
    expect(state.clientKeys).not.toContain('anon-test');
  });

  it('500 on a DB error', async () => {
    state.error = { message: 'boom' };
    const res = mockRes();
    await handler(resolveReq(OWNER_NID), res);
    expect(res.statusCode).toBe(500);
  });
});
