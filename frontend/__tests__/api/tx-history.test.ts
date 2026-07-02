import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/tx-history';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const ETH_ADDR = '0x' + 'a'.repeat(40);

const TX_ROW_KEYS = ['id', 'chain', 'type', 'amount', 'address', 'hash', 'date', 'fee'].sort();

describe('GET /api/tx-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETHERSCAN_API_KEY = 'etherscan-key';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('returns 401 without a valid Supabase JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ query: { eth: ETH_ADDR } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ query: { eth: ETH_ADDR } }), res);
    expect(res.statusCode).toBe(429);
    expect(mockedLimit).toHaveBeenCalledWith('tx-history:user-1', 30);
  });

  it('rejects malformed addresses (query injection) with 400', async () => {
    const res = mockRes();
    await handler(
      mockReq({ query: { eth: `${ETH_ADDR}&action=balance&apikey=stolen` } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns mapped rows only and never leaks the Etherscan key or raw fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '1',
        result: [
          {
            hash: '0xdeadbeef',
            from: ETH_ADDR,
            to: '0x' + 'b'.repeat(40),
            value: '1000000000000000000',
            timeStamp: '1719900000',
            gasUsed: '21000',
            gasPrice: '1000000000',
            isError: '0',
            // extra upstream fields that must NOT be proxied to the client:
            blockNumber: '123',
            confirmations: '10',
            input: '0x',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await handler(mockReq({ query: { eth: ETH_ADDR } }), res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { transactions: Array<Record<string, unknown>> };
    expect(body.transactions.length).toBeGreaterThan(0);
    for (const row of body.transactions) {
      expect(Object.keys(row).sort()).toEqual(TX_ROW_KEYS);
    }
    expect(JSON.stringify(body)).not.toContain('etherscan-key');

    const actions = mockedAudit.mock.calls.map((c) => c[1]);
    expect(actions).toContain('tx_history_requested');
    vi.unstubAllGlobals();
  });
});
