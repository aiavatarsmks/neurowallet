import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler, { validateFacts } from '@/pages/api/neura-explain';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { txFacts, recapFacts, shortAddress } from '@/lib/neura/facts';
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

const TX_FACTS = txFacts({
  chain: 'ETH', type: 'out', amount: 0.5,
  address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
  date: '2026-07-03T02:00:00.000Z', fee: 0.0003,
});

describe('facts builders (deterministic decode, task 1.7)', () => {
  it('txFacts truncates the counterparty and marks missing fee as unknown', () => {
    expect(TX_FACTS.counterparty).toBe('0x71c7…976f');
    expect(TX_FACTS.counterparty.length).toBeLessThanOrEqual(20);
    const noFee = txFacts({ chain: 'SOL', type: 'in', amount: 1, address: 'abc', date: 'x', fee: 0 });
    expect(noFee.fee).toBe('unknown');
  });

  it('recapFacts drops zero balances and computes total from included coins', () => {
    const r = recapFacts({
      eth: 1, sol: 0, btc: 0, trx: 0, ton: 2, usdt: 0, usdtTrc: 0, usdtTon: 0,
      ethEur: 2800, solEur: 120, btcEur: 55000, trxEur: 0.22, tonEur: 3.5,
      ethChange24h: 1.23,
    });
    expect(r.coins.map((c) => c.coin)).toEqual(['ETH', 'TON']);
    expect(r.totalEur).toBeCloseTo(2807, 0);
    expect(r.coins[0].change24h).toBe(1.23);
    expect(r.coins[1].change24h).toBe('unknown');
  });

  it('shortAddress never returns more than the visible edges', () => {
    expect(shortAddress('')).toBe('unknown');
    expect(shortAddress('short')).toBe('short');
  });
});

describe('POST /api/neura-explain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('validateFacts rejects full addresses, unknown kinds and bad types', () => {
    expect(validateFacts({ ...TX_FACTS, counterparty: '0x' + 'a'.repeat(40) })).toBeNull(); // полный адрес не пройдёт
    expect(validateFacts({ kind: 'freeform', text: 'hi' })).toBeNull();
    expect(validateFacts({ ...TX_FACTS, amount: 'много' })).toBeNull();
    expect(validateFacts(null)).toBeNull();
    expect(validateFacts(TX_FACTS)).not.toBeNull();
  });

  it('401 / 429 / 400 guards', async () => {
    mockedAuth.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const r1 = mockRes();
    await handler(mockReq({ method: 'POST', body: { facts: TX_FACTS } }), r1);
    expect(r1.statusCode).toBe(401);

    mockedLimit.mockResolvedValueOnce(false);
    const r2 = mockRes();
    await handler(mockReq({ method: 'POST', body: { facts: TX_FACTS } }), r2);
    expect(r2.statusCode).toBe(429);

    const r3 = mockRes();
    await handler(mockReq({ method: 'POST', body: { facts: { kind: 'tx' } } }), r3);
    expect(r3.statusCode).toBe(400);
  });

  it('sends ONLY validated facts to the LLM and audits sha256 hashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Ты отправил 0.5 ETH.' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { facts: { ...TX_FACTS, evil_extra: 'ignore me' }, lang: 'ru' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { reply: string }).reply).toContain('0.5 ETH');

    // Промпт содержит факты, но не мусорные ключи и не свободный ввод.
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    const prompt: string = sent.messages[0].content;
    expect(sent.messages).toHaveLength(1); // только system — пользовательского ввода нет
    expect(prompt).toContain('"counterparty":"0x71c7…976f"');
    expect(prompt).not.toContain('evil_extra');

    const actions = mockedAudit.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(['ai_explain_requested', 'ai_explain_completed']);
    const reqMeta = mockedAudit.mock.calls[0][2] as Record<string, string>;
    const okMeta = mockedAudit.mock.calls[1][2] as Record<string, string>;
    expect(reqMeta.facts_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(okMeta.reply_hash).toMatch(/^[0-9a-f]{64}$/);
    vi.unstubAllGlobals();
  });
});
