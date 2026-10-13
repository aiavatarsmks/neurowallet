import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '@/pages/api/tg-notify';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { composeTxSentMessage, escapeHtml, parseTxSentNotice } from '@/lib/server/tg-notify-template';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

type AuthResult = Awaited<ReturnType<typeof requireSupabaseUser>>;

/** Verified id lives in app_metadata (service-role written by tg-auth). */
function authUser(appTelegramId?: number, userMetaTelegramId?: number): AuthResult {
  return {
    user: {
      id: 'user-1',
      app_metadata: appTelegramId ? { telegram_id: appTelegramId, source: 'telegram_mini_app' } : {},
      user_metadata: userMetaTelegramId ? { telegram_id: userMetaTelegramId } : {},
    },
    token: 'jwt',
  } as unknown as AuthResult;
}

const ETH_TO = '0x1234567890abcdef1234567890abcdef12345678';
const ETH_HASH = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function validBody(over: Record<string, unknown> = {}) {
  return { kind: 'tx_sent', coin: 'ETH', amount: '0.015', to: ETH_TO, hash: ETH_HASH, ...over };
}

describe('POST /api/tg-notify', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    mockedAuth.mockResolvedValue(authUser(42));
    mockedLimit.mockResolvedValue(true);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 without a valid Supabase JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody() }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody() }), res);
    expect(res.statusCode).toBe(429);
  });

  it('returns 403 when the account has no verified telegram_id', async () => {
    mockedAuth.mockResolvedValue(authUser(undefined));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody() }), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PHISHING REGRESSION: user_metadata.telegram_id alone never gets a message (403)', async () => {
    // Attacker: email account + supabase.auth.updateUser({ data: { telegram_id: victim } })
    mockedAuth.mockResolvedValue(authUser(undefined, 777));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody() }), res);
    expect(res.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the legacy free-text { message } contract with 400', async () => {
    const res = mockRes();
    await handler(
      mockReq({ method: 'POST', body: { message: '<a href="https://evil.example">Verify wallet</a>' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a { message } smuggled next to a valid template: message is never sent', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody({ message: 'PHISH' }) }), res);
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.text).not.toContain('PHISH');
  });

  it.each([
    ['kind', { kind: 'custom' }],
    ['kind missing', { kind: undefined }],
    ['coin', { coin: 'DOGE' }],
    ['coin label', { coin: 'USDT ERC-20' }],
    ['amount exp', { amount: '1e-7' }],
    ['amount number', { amount: 0.5 }],
    ['amount html', { amount: '1<b>' }],
    ['amount too long', { amount: '1'.repeat(19) }],
    ['to html', { to: '<a href=x>' }],
    ['to space', { to: 'abc def' }],
    ['to too long', { to: 'a'.repeat(129) }],
    ['to empty', { to: '' }],
    ['hash html', { hash: '"><script>' }],
    ['hash number', { hash: 123 }],
  ])('400 on invalid %s', async (_label, over) => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody(over) }), res);
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a server-composed RU message to the verified id only, ignoring body telegramId', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody({ telegramId: 999999 }) }), res);

    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/sendMessage');
    const sent = JSON.parse(init.body as string);
    expect(sent.chat_id).toBe(42); // from app_metadata, NOT 999999 from body
    expect(sent.parse_mode).toBe('HTML');
    expect(sent.text).toBe(
      '✅ <b>Транзакция отправлена</b>\n\n💸 0.015 ETH\n📤 На адрес: <code>0x1234...5678</code>\n🔗 TX: <code>0xabcdef01234567...</code>',
    );

    const actions = mockedAudit.mock.calls.map((c) => c[1]);
    expect(actions).toContain('telegram_notification_requested');
    expect(actions).toContain('telegram_notification_sent');
  });

  it('EN template + coin label mapping', async () => {
    const res = mockRes();
    await handler(
      mockReq({ method: 'POST', body: validBody({ coin: 'TRC20', amount: '25', to: 'TXyz1234567890abcdefghijklmnopqrst', hash: 'f'.repeat(64), lang: 'en' }) }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.text).toBe(
      '✅ <b>Transaction sent</b>\n\n💸 25 USDT (TRC-20)\n📤 To address: <code>TXyz12...qrst</code>\n🔗 TX: <code>ffffffffffffffff...</code>',
    );
  });

  it('audit rows never carry the full destination address or tx hash', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: validBody() }), res);
    const serialized = JSON.stringify(mockedAudit.mock.calls.map((c) => c[2]));
    expect(serialized).not.toContain(ETH_TO);
    expect(serialized).not.toContain(ETH_HASH);
    const requested = mockedAudit.mock.calls.find((c) => c[1] === 'telegram_notification_requested')!;
    expect(requested[2]).toMatchObject({ telegram_id: 42, kind: 'tx_sent', coin: 'ETH' });
    expect(typeof (requested[2] as { message_chars: number }).message_chars).toBe('number');
  });
});

describe('tg-notify template helpers', () => {
  it('maps every allowlisted coin to its label', () => {
    const labels: Record<string, string> = {
      ETH: 'ETH', USDT: 'USDT (ERC-20)', BTC: 'BTC', SOL: 'SOL', TRX: 'TRX',
      TRC20: 'USDT (TRC-20)', TON: 'TON', USDT_TON: 'USDT (TON)',
    };
    for (const [coin, label] of Object.entries(labels)) {
      const p = parseTxSentNotice({ kind: 'tx_sent', coin, amount: '1', to: 'abcdefghijkl', hash: 'h1' });
      expect(p.ok).toBe(true);
      if (p.ok) expect(composeTxSentMessage(p.value)).toContain(`💸 1 ${label}\n`);
    }
  });

  it('defaults lang to ru for anything but en', () => {
    const p = parseTxSentNotice({ kind: 'tx_sent', coin: 'BTC', amount: '1', to: 'bc1qxyz', hash: 'h', lang: 'de' });
    expect(p.ok && p.value.lang).toBe('ru');
  });

  it('escapeHtml neutralises markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('accepts TON raw-form and SOL-style refs within the charset', () => {
    expect(parseTxSentNotice({ kind: 'tx_sent', coin: 'TON', amount: '1.5', to: '0:' + 'a'.repeat(64), hash: 'abc_DEF-12.3' }).ok).toBe(true);
  });
});
