import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/recipient-history';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ to_address: string }>,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: state.rows, error: state.error }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('GET /api/recipient-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [];
    state.error = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without JWT, 400 on unknown coin', async () => {
    mockedAuth.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res1 = mockRes();
    await handler(mockReq({ query: { coin: 'ETH' } }), res1);
    expect(res1.statusCode).toBe(401);

    const res2 = mockRes();
    await handler(mockReq({ query: { coin: 'DOGE' } }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it('returns deduplicated addresses of sent drafts', async () => {
    state.rows = [{ to_address: '0xaaa' }, { to_address: '0xbbb' }, { to_address: '0xaaa' }];
    const res = mockRes();
    await handler(mockReq({ query: { coin: 'ETH' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { addresses: string[] }).addresses).toEqual(['0xaaa', '0xbbb']);
  });

  it('degrades to empty list when the table does not exist yet', async () => {
    state.error = { message: 'relation "tx_drafts" does not exist' };
    const res = mockRes();
    await handler(mockReq({ query: { coin: 'ETH' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { addresses: string[] }).addresses).toEqual([]);
  });
});
