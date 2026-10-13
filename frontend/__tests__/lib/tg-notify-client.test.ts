import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildTxSentNotice,
  noticeAmount,
  noticeRef,
  postTxSentNotice,
} from '@/lib/tg-notify-client';
import { parseTxSentNotice, TG_NOTIFY_COINS } from '@/lib/server/tg-notify-template';

const ETH_TO = '0x' + 'a'.repeat(40);
const ETH_HASH = '0x' + 'b'.repeat(64);

afterEach(() => vi.unstubAllGlobals());

describe('tg-notify client body (new server contract)', () => {
  it('every screen coin builds a body the server parser accepts', () => {
    for (const coin of TG_NOTIFY_COINS) {
      const body = buildTxSentNotice({ coin, amount: '12.5', to: ETH_TO, hash: ETH_HASH, lang: 'en' });
      expect(body).not.toBeNull();
      const parsed = parseTxSentNotice(body);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.coin).toBe(coin);
    }
  });

  it('sends the typed decimal string, never an exponent form', () => {
    const body = buildTxSentNotice({ coin: 'TRC20', amount: '0.0000001', to: ETH_TO, hash: ETH_HASH, lang: 'ru' });
    expect(body?.amount).toBe('0.0000001');
    expect(parseTxSentNotice(body).ok).toBe(true);
    expect(noticeAmount(String(0.0000001))).toBeNull(); // '1e-7' would fail on the server
  });

  it('normalizes edge forms of a typed amount', () => {
    expect(noticeAmount('1.')).toBe('1');
    expect(noticeAmount('.5')).toBe('0.5');
    expect(noticeAmount('0')).toBeNull();
    expect(noticeAmount('0.000')).toBeNull();
    expect(noticeAmount('')).toBeNull();
    expect(noticeAmount('1,5')).toBeNull();
    expect(noticeAmount('1' + '0'.repeat(18))).toBeNull(); // 19 integer digits
  });

  it('keeps the full recipient address and hash', () => {
    const body = buildTxSentNotice({ coin: 'ETH', amount: '1', to: ETH_TO, hash: ETH_HASH, lang: 'en' });
    expect(body).toEqual({ kind: 'tx_sent', coin: 'ETH', amount: '1', to: ETH_TO, hash: ETH_HASH, lang: 'en' });
  });

  it('TON synthetic hash and user-friendly addresses pass as is', () => {
    const body = buildTxSentNotice({
      coin: 'USDT_TON',
      amount: '3',
      to: 'UQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M-',
      hash: 'ton:seqno:42',
      lang: 'ru',
    });
    expect(body?.hash).toBe('ton:seqno:42');
    expect(parseTxSentNotice(body).ok).toBe(true);
  });

  it('base64 hashes are re-encoded as base64url; anything else is skipped', () => {
    expect(noticeRef('ab+c/d==')).toBe('ab-c_d');
    expect(noticeRef('<b>x</b>')).toBeNull();
    expect(noticeRef('a'.repeat(129))).toBeNull();
    expect(buildTxSentNotice({ coin: 'TON', amount: '1', to: ETH_TO, hash: 'bad hash!', lang: 'ru' })).toBeNull();
    expect(buildTxSentNotice({ coin: 'DOGE', amount: '1', to: ETH_TO, hash: ETH_HASH, lang: 'ru' })).toBeNull();
  });

  it('never sends free text: no message/html field in the body', () => {
    const body = buildTxSentNotice({ coin: 'BTC', amount: '0.01', to: ETH_TO, hash: ETH_HASH, lang: 'en' })!;
    expect(Object.keys(body).sort()).toEqual(['amount', 'coin', 'hash', 'kind', 'lang', 'to']);
  });

  it('postTxSentNotice is best-effort: network errors and 4xx/5xx never throw', async () => {
    const body = buildTxSentNotice({ coin: 'BTC', amount: '0.01', to: ETH_TO, hash: ETH_HASH, lang: 'en' })!;
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{"error":"bad"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postTxSentNotice(body, 'tok', 'trace')).resolves.toBeUndefined();
    await expect(postTxSentNotice(body, 'tok')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tg-notify');
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-trace-id']).toBe('trace');
  });
});
