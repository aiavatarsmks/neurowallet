// @vitest-environment node
/**
 * TON send outcome: the real @ton/ton wallet flow (seqno read, signing, the
 * external message) runs against a fake toncenter HttpApi; only sendBoc's
 * answer is varied. A lost answer is settled by the wallet seqno, never turned
 * into a retryable error. Throwaway seed, never funded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const T = vi.hoisted(() => ({
  seqno: 7,
  addrInfoFailFrom: Infinity, // getAddressInformation call index from which it fails
  addrInfoCalls: 0,
  sendBoc: (async () => undefined) as (boc: Buffer) => Promise<void>,
  seeds: [] as Buffer[],
  secrets: [] as Buffer[],
}));

vi.mock('@ton/crypto', async (orig) => {
  const actual = await orig<typeof import('@ton/crypto')>();
  return {
    ...actual,
    keyPairFromSeed: (seed: Buffer) => {
      const kp = actual.keyPairFromSeed(seed);
      T.seeds.push(seed);
      T.secrets.push(kp.secretKey);
      return kp;
    },
  };
});

vi.mock('@ton/ton', async (orig) => {
  const actual = await orig<typeof import('@ton/ton')>();
  const jettonWallet = actual.beginCell()
    .storeAddress(new actual.Address(0, Buffer.alloc(32, 0x22)))
    .endCell().toBoc().toString('base64');
  const fakeApi = {
    async getAddressInformation() {
      T.addrInfoCalls += 1;
      if (T.addrInfoCalls >= T.addrInfoFailFrom) throw Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
      return {
        balance: '5000000000', extra_currencies: [], state: 'active', code: '', data: '',
        last_transaction_id: { lt: '0', hash: '' }, block_id: { workchain: -1, shard: '0', seqno: 1 }, sync_utime: 0,
      };
    },
    async callGetMethod(_address: unknown, name: string) {
      if (name === 'seqno') return { gas_used: 0, exit_code: 0, stack: [['num', '0x' + T.seqno.toString(16)]] };
      if (name === 'get_wallet_address') return { gas_used: 0, exit_code: 0, stack: [['cell', { bytes: jettonWallet }]] };
      throw new Error(`unexpected get-method ${name}`);
    },
    sendBoc: (boc: Buffer) => T.sendBoc(boc),
  };
  class TestTonClient extends actual.TonClient {
    constructor(params: ConstructorParameters<typeof actual.TonClient>[0]) {
      super(params);
      (this as unknown as { api: unknown }).api = fakeApi;
    }
  }
  return { ...actual, TonClient: TestTonClient };
});

import { Address } from '@ton/ton';
import { sendTonRaw, sendUsdtTonRaw } from '@/lib/crypto/ton-tx';
import { BroadcastOutcomeUnknownError, isBroadcastOutcomeUnknown } from '@/lib/crypto/broadcast-error';

const SEED = new Uint8Array(32).fill(0x2a);
const TO = new Address(0, Buffer.alloc(32, 0x11)).toString({ bounceable: false });
/** What tx-status.ts getTxStatus('TON', hash) accepts. */
const TON_HASH_RE = /^ton:seqno:(\d{1,10})$/;

// axios errors as @ton/ton's HttpApi surfaces them
const axiosHttp = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, name: 'AxiosError', code: status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', response: { status, data } });
const axiosNetwork = () => Object.assign(new Error('Network Error'), { isAxiosError: true, name: 'AxiosError', code: 'ERR_NETWORK' });
const axiosTimeout = () => Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true, name: 'AxiosError', code: 'ECONNABORTED' });
const REJECTED = 'LITE_SERVER_UNKNOWN: cannot apply external message to current state : External message was not accepted\nCannot run message on account: inbound external message rejected by transaction';

/** toncenter /runGetMethod seqno answers for the post-failure check (in order; the last one repeats). */
function seqnoAfter(...answers: Array<number | 'error' | 'uninit'>) {
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://toncenter.com/api/v2/runGetMethod');
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: 'seqno', stack: [] });
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a === 'error') return new Response('Too Many Requests', { status: 429 });
    if (a === 'uninit') return new Response(JSON.stringify({ ok: true, result: { exit_code: -13, stack: [] } }));
    return new Response(JSON.stringify({ ok: true, result: { exit_code: 0, stack: [['num', '0x' + a.toString(16)]] } }));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Run with fake timers (the seqno re-check waits 1.1 s between reads). */
async function run<T>(p: Promise<T>): Promise<T | Error> {
  const settled = p.catch((e: Error) => e);
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(600);
  return settled;
}

const allZero = (b: Buffer) => b.every((x) => x === 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  T.seqno = 7;
  T.addrInfoFailFrom = Infinity;
  T.addrInfoCalls = 0;
  T.sendBoc = vi.fn(async () => undefined);
  T.seeds = [];
  T.secrets = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sendTonRaw: outcome of the external message', () => {
  it('accepted → ton:seqno:N, no seqno re-check, key material wiped', async () => {
    const fetchMock = seqnoAfter(8);
    const r = await run(sendTonRaw(SEED, TO, 0.5));
    expect(r).toBe('ton:seqno:7');
    expect(T.sendBoc).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(T.seeds.every(allZero) && T.secrets.every(allZero)).toBe(true);
  });

  it('network error after hand-over, seqno already past N → success', async () => {
    T.sendBoc = vi.fn(async () => { throw axiosNetwork(); });
    seqnoAfter(8);
    expect(await run(sendTonRaw(SEED, TO, 0.5))).toBe('ton:seqno:7');
  });

  it.each([
    ['timeout', axiosTimeout],
    ['HTTP 502', () => axiosHttp(502, '<html>Bad Gateway</html>')],
    ['HTTP 429', () => axiosHttp(429, { ok: false, error: 'Ratelimit exceed', code: 429 })],
    ['200 without ok:true (non-JSON page)', () => new Error('Received error: "<html>…</html>"')],
  ])('%s and seqno still N → BroadcastOutcomeUnknownError("ton:seqno:N")', async (_name, error) => {
    T.sendBoc = vi.fn(async () => { throw error(); });
    const fetchMock = seqnoAfter(7);
    const err = await run(sendTonRaw(SEED, TO, 0.5));
    expect(err).toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect((err as BroadcastOutcomeUnknownError).hash).toBe('ton:seqno:7');
    expect((err as BroadcastOutcomeUnknownError).hash).toMatch(TON_HASH_RE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(T.seeds.every(allZero) && T.secrets.every(allZero)).toBe(true);
  });

  it('the seqno read fails (429) → read once more after 1.1 s; still unreadable → unknown', async () => {
    T.sendBoc = vi.fn(async () => { throw axiosNetwork(); });
    const fetchMock = seqnoAfter('error', 'error');
    expect(isBroadcastOutcomeUnknown(await run(sendTonRaw(SEED, TO, 0.5)))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('first seqno read rate-limited, second shows N+1 → success', async () => {
    T.sendBoc = vi.fn(async () => { throw axiosNetwork(); });
    seqnoAfter('error', 8);
    expect(await run(sendTonRaw(SEED, TO, 0.5))).toBe('ton:seqno:7');
  });

  it('uninitialized wallet (first send, seqno 0) and a lost answer → unknown, not success', async () => {
    T.seqno = 0;
    T.sendBoc = vi.fn(async () => { throw axiosTimeout(); });
    seqnoAfter('uninit');
    const err = await run(sendTonRaw(SEED, TO, 0.5));
    expect(err).toMatchObject({ name: 'BroadcastOutcomeUnknownError', hash: 'ton:seqno:0' });
  });

  it('"cannot apply external message" (HTTP 500 from toncenter) is a definitive rejection: original error, no re-check', async () => {
    const rejected = axiosHttp(500, { ok: false, error: REJECTED, code: 500 });
    T.sendBoc = vi.fn(async () => { throw rejected; });
    const fetchMock = seqnoAfter(8);
    const err = await run(sendTonRaw(SEED, TO, 0.5));
    expect(err).toBe(rejected);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(T.seeds.every(allZero) && T.secrets.every(allZero)).toBe(true);
  });

  it('a 4xx (request refused) is definitive too', async () => {
    const refused = axiosHttp(422, { ok: false, error: 'Validation error', code: 422 });
    T.sendBoc = vi.fn(async () => { throw refused; });
    seqnoAfter(8);
    expect(await run(sendTonRaw(SEED, TO, 0.5))).toBe(refused);
  });

  it('a failure before the message was handed over (deploy-state read) is an ordinary error', async () => {
    T.addrInfoFailFrom = 2; // 1st: getSeqno's state read; 2nd: the external message's deploy check
    const fetchMock = seqnoAfter(8);
    const err = await run(sendTonRaw(SEED, TO, 0.5));
    expect(isBroadcastOutcomeUnknown(err)).toBe(false);
    expect((err as Error).message).toBe('Network Error');
    expect(T.sendBoc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendUsdtTonRaw: same rules', () => {
  it('accepted → ton:seqno:N', async () => {
    seqnoAfter(8);
    expect(await run(sendUsdtTonRaw(SEED, TO, 1.5))).toBe('ton:seqno:7');
    expect(T.sendBoc).toHaveBeenCalledTimes(1);
  });

  it('lost answer + seqno not advanced → BroadcastOutcomeUnknownError("ton:seqno:N"), key wiped', async () => {
    T.sendBoc = vi.fn(async () => { throw axiosHttp(504, 'Gateway Time-out'); });
    seqnoAfter(7);
    const err = await run(sendUsdtTonRaw(SEED, TO, 1.5));
    expect(err).toMatchObject({ name: 'BroadcastOutcomeUnknownError', hash: 'ton:seqno:7' });
    expect(T.seeds.every(allZero) && T.secrets.every(allZero)).toBe(true);
  });

  it('lost answer + seqno advanced → success', async () => {
    T.sendBoc = vi.fn(async () => { throw axiosNetwork(); });
    seqnoAfter(9);
    expect(await run(sendUsdtTonRaw(SEED, TO, 1.5))).toBe('ton:seqno:7');
  });
});
