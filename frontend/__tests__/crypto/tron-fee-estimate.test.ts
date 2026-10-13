// Node env: under jsdom, ethers' sha256 hands back a cross-realm Buffer and every
// base58check validation fails (pre-existing test-env quirk, not a browser issue).
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import bs58 from 'bs58';
import { simulateTransfer, isBlocked, SIM_DETAIL_I18N, type SimCoin } from '@/lib/crypto/simulate';
import { estimateTronFee, USDT_TRC20_FEE_LIMIT_SUN } from '@/lib/crypto/tron-tx';
import { translations } from '@/lib/i18n';
import chainParams from './fixtures/tron/getchainparameters.json';
import exchangeResource from './fixtures/tron/getaccountresource_exchange.json';
import existingHolder from './fixtures/tron/triggerconstantcontract_existing_holder.json';
import newHolder from './fixtures/tron/triggerconstantcontract_new_holder.json';
import reverted from './fixtures/tron/triggerconstantcontract_revert.json';
import notActivated from './fixtures/tron/getaccount_not_activated.json';

const SENDER = 'TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi';
const hex21 = (addr: string) => Buffer.from(bs58.decode(addr).slice(0, 21)).toString('hex');
const SENDER_HEX = hex21(SENDER);
const FRESH = newHolder.to;          // never-used address (captured as a new USDT holder)
const HOLDER = existingHolder.to;    // existing USDT holder

const BALANCES: Record<SimCoin, number> = {
  ETH: 0, BTC: 0, SOL: 0, USDT: 0, TRX: 15, TRC20: 100, TON: 0, USDT_TON: 0,
};
const RATES = { eth: 2800, btc: 55000, sol: 120, trx: 0.25, ton: 3.5 };

/** A typical wallet user: no stake, daily free bandwidth untouched. */
const USER_RESOURCE = { freeNetLimit: 600, TotalNetLimit: 43200000000, TotalNetWeight: 26685852860, TotalEnergyLimit: 180000000000, TotalEnergyWeight: 18729491085 };

type Reply = () => Promise<unknown>;
const ok = (body: unknown): Reply => async () => ({ ok: true, status: 200, json: async () => body });
const httpError = (status: number): Reply => async () => ({ ok: false, status, json: async () => ({}) });
const hang: Reply = () => new Promise(() => { /* never settles */ });

function withEnergyFee(sunPerEnergy: number) {
  return {
    chainParameter: chainParams.chainParameter.map((p) =>
      p.key === 'getEnergyFee' ? { ...p, value: sunPerEnergy } : p),
  };
}

function mockTronGrid(over: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    '/wallet/getchainparameters': ok(chainParams),
    '/wallet/getaccountresource': ok(USER_RESOURCE),
    '/wallet/triggerconstantcontract': ok(newHolder.response),
    '/wallet/getaccount': ok({ address: HOLDER, balance: 5_000_000, create_time: 1629452451000 }),
    ...over,
  };
  const fn = vi.fn((url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    const reply = replies[path];
    if (!reply) throw new Error(`unexpected call ${path}`);
    return reply();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const calledPaths = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => new URL(c[0] as string).pathname);

function sim(coin: 'TRX' | 'TRC20', over: Partial<Parameters<typeof simulateTransfer>[0]> = {}) {
  return simulateTransfer({
    coin,
    toAddress: FRESH,
    amount: 10,
    balances: BALANCES,
    eurRates: RATES,
    fromTronAddress: SENDER,
    timeoutMs: 400,
    ...over,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('USDT TRC-20: energy-based fee', () => {
  it('new holder, no stake, free bandwidth: burn = energy_used × getEnergyFee (13.0285 TRX)', async () => {
    const fetchMock = mockTronGrid();
    const r = await sim('TRC20');
    expect(r.status).toBe('ok');
    expect(r.feeNative).toBeCloseTo(130_285 * 100 / 1e6, 9);
    expect(r.feeCurrency).toBe('TRX');
    expect(r.feeEur).toBeCloseTo(13.0285 * 0.25, 6);
    expect(r.warnings).toEqual([]);
    expect(isBlocked(r)).toBe(false);
    expect(r.tron).toMatchObject({
      source: 'live', energyUsed: 130_285, energyAvailable: 0, energyFeeSun: 100,
      energyBurnTrx: 13.0285, energyCostTrx: 13.0285, feeLimitTrx: 30,
      exceedsFeeLimit: false, bandwidthBytes: 345, bandwidthBurnTrx: 0,
    });
    // dry run is transfer(recipient, amount) from the sender, never a build/broadcast
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/wallet/triggerconstantcontract'))!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body).toMatchObject({ owner_address: SENDER_HEX, contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c', call_value: 0 });
    expect(body.data).toBe('a9059cbb' + '0'.repeat(24) + hex21(FRESH).slice(2) + (10_000_000).toString(16).padStart(64, '0'));
    expect(hex21(FRESH).slice(2)).toBe('7c2dd837a0a20eaa901abf5ad3a02c44f1e07b54'); // as seen in the captured Transfer log
    expect(calledPaths(fetchMock).sort()).toEqual(['/wallet/getaccountresource', '/wallet/getchainparameters', '/wallet/triggerconstantcontract']);
  });

  it('existing holder costs about half (64 285 energy → 6.4285 TRX)', async () => {
    mockTronGrid({ '/wallet/triggerconstantcontract': ok(existingHolder.response) });
    const r = await sim('TRC20', { toAddress: HOLDER });
    expect(r.feeNative).toBeCloseTo(6.4285, 9);
  });

  it('enough staked energy and bandwidth: nothing is burned', async () => {
    mockTronGrid({ '/wallet/getaccountresource': ok(exchangeResource) });
    const r = await sim('TRC20');
    expect(r.feeNative).toBe(0);
    expect(r.tron).toMatchObject({ energyAvailable: 1_165_687_438 - 709_508_239, energyBurnTrx: 0, bandwidthBurnTrx: 0 });
    expect(r.warnings).toEqual([]);
  });

  it('partial stake: only the missing energy is burned', async () => {
    mockTronGrid({ '/wallet/getaccountresource': ok({ ...USER_RESOURCE, EnergyLimit: 100_000, EnergyUsed: 20_000 }) });
    const r = await sim('TRC20');
    expect(r.feeNative).toBeCloseTo((130_285 - 80_000) * 100 / 1e6, 9);
  });

  it('no free bandwidth left: 345 bytes × 1000 sun are burned too', async () => {
    mockTronGrid({ '/wallet/getaccountresource': ok({ ...USER_RESOURCE, freeNetUsed: 400 }) });
    const r = await sim('TRC20');
    expect(r.tron?.bandwidthBurnTrx).toBeCloseTo(0.345, 9);
    expect(r.feeNative).toBeCloseTo(13.0285 + 0.345, 9);
  });

  it('not enough TRX for the estimated burn → blocked (insufficient_fee_balance)', async () => {
    mockTronGrid();
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 13 } }); // needs 13.0285
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
    expect(isBlocked(r)).toBe(true);
  });

  it('~15 TRX is enough at today\'s price for a new holder (the static 14 TRX was close to the edge)', async () => {
    mockTronGrid();
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 15 } });
    expect(isBlocked(r)).toBe(false);
  });

  it('energy cost above fee_limit → BLOCKING, even with plenty of TRX (would end in OUT_OF_ENERGY)', async () => {
    mockTronGrid({ '/wallet/getchainparameters': ok(withEnergyFee(420)) }); // 130 285 × 420 sun = 54.7 TRX > 30
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 1000 } });
    expect(r.tron?.exceedsFeeLimit).toBe(true);
    expect(r.tron?.energyCostTrx).toBeCloseTo(54.7197, 4);
    expect(r.warnings).toEqual([{ level: 'block', code: 'insufficient_fee_balance', detail: 'tron_fee_limit_exceeded' }]);
    expect(isBlocked(r)).toBe(true);
  });

  it('fee_limit caps staked energy too, so a big stake does not lift the block', async () => {
    mockTronGrid({
      '/wallet/getchainparameters': ok(withEnergyFee(420)),
      '/wallet/getaccountresource': ok(exchangeResource),
    });
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 1000 } });
    expect(r.feeNative).toBe(0);            // nothing would be burned...
    expect(isBlocked(r)).toBe(true);        // ...but the call cannot get that much energy under fee_limit
  });

  it('fee-limit block and low TRX produce one warning entry, not two', async () => {
    mockTronGrid({ '/wallet/getchainparameters': ok(withEnergyFee(420)) });
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 1 } });
    expect(r.warnings.filter((w) => w.code === 'insufficient_fee_balance')).toEqual([
      { level: 'block', code: 'insufficient_fee_balance', detail: 'tron_fee_limit_exceeded' },
    ]);
  });

  it('exactly at fee_limit is allowed', async () => {
    const energy = USDT_TRC20_FEE_LIMIT_SUN / 100;
    mockTronGrid({ '/wallet/triggerconstantcontract': ok({ ...newHolder.response, energy_used: energy }) });
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 100 } });
    expect(r.tron?.exceedsFeeLimit).toBe(false);
    expect(isBlocked(r)).toBe(false);
  });
});

describe('fallback to the static estimate', () => {
  const expectFallback = (r: Awaited<ReturnType<typeof simulateTransfer>>, fee: number) => {
    expect(r.status).toBe('ok');
    expect(r.feeNative).toBe(fee);
    expect(r.tron?.source).toBe('static');
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'simulation_failed', detail: 'tron_fee_estimate_unavailable' });
    expect(isBlocked(r)).toBe(false);
  };

  it('HTTP error from TronGrid → static 14 TRX + non-blocking flag', async () => {
    mockTronGrid({ '/wallet/getchainparameters': httpError(503) });
    expectFallback(await sim('TRC20'), 14);
  });

  it('a dry run that failed for another reason (CPU timeout) → static, non-blocking', async () => {
    const cpuTimeout = {
      ...reverted.response,
      result: { result: true, message: Buffer.from("CPU timeout for 'PUSH1' operation executing").toString('hex') },
    };
    mockTronGrid({ '/wallet/triggerconstantcontract': ok(cpuTimeout) });
    const r = await sim('TRC20');
    expectFallback(r, 14);
    expect(r.tron?.unavailableReason).toBe('TRON_ESTIMATE_DRY_RUN_FAILED');
  });

  it('API error body / malformed resource → static', async () => {
    mockTronGrid({ '/wallet/getaccountresource': ok({ Error: 'class org.tron.core.services.http.JsonFormat$ParseException' }) });
    expectFallback(await sim('TRC20'), 14);
    mockTronGrid({ '/wallet/getaccountresource': ok({ EnergyLimit: 'lots' }) });
    expectFallback(await sim('TRC20'), 14);
  });

  it('network error → static (TRX: 1.1)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expectFallback(await sim('TRX'), 1.1);
  });

  it('hanging provider → static before the simulation timeout, not a "timeout" result', async () => {
    mockTronGrid({ '/wallet/getchainparameters': hang });
    expectFallback(await sim('TRC20', { timeoutMs: 200 }), 14);
  });

  it('fallback still blocks when TRX cannot cover the static fee', async () => {
    mockTronGrid({ '/wallet/getchainparameters': httpError(500) });
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 2 } });
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
    expect(isBlocked(r)).toBe(true);
  });

  it('unknown sender address → static + flag, no network call', async () => {
    const fetchMock = mockTronGrid();
    const r = await sim('TRC20', { fromTronAddress: undefined });
    expectFallback(r, 14);
    expect(r.tron?.unavailableReason).toBe('no_sender_address');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid recipient → no network call and no extra "estimate unavailable" noise', async () => {
    const fetchMock = mockTronGrid();
    const r = await sim('TRC20', { toAddress: 'TXnotAnAddress' });
    expect(r.warnings).toContainEqual({ level: 'block', code: 'invalid_address' });
    expect(r.warnings.some((w) => w.detail === 'tron_fee_estimate_unavailable')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TRX: recipient activation and bandwidth', () => {
  it('activated recipient + free bandwidth → no burn, no notice', async () => {
    const fetchMock = mockTronGrid();
    const r = await sim('TRX', { toAddress: HOLDER, amount: 5 });
    expect(r.feeNative).toBe(0);
    expect(r.tron).toMatchObject({ source: 'live', recipientActivated: true, activationFeeTrx: 0, bandwidthBurnTrx: 0 });
    expect(r.notices).toBeUndefined();
    expect(r.balanceAfter).toBeCloseTo(10, 9);
    expect(calledPaths(fetchMock)).toContain('/wallet/getaccount');
    expect(calledPaths(fetchMock)).not.toContain('/wallet/triggerconstantcontract');
  });

  it('activated recipient, free bandwidth used up → 280 bytes × 1000 sun', async () => {
    mockTronGrid({ '/wallet/getaccountresource': ok({ ...USER_RESOURCE, freeNetUsed: 500 }) });
    const r = await sim('TRX', { toAddress: HOLDER, amount: 5 });
    expect(r.feeNative).toBeCloseTo(0.28, 9);
  });

  it('non-activated recipient → +1 TRX creation fee (+0.1 TRX bandwidth without stake) and a non-blocking notice', async () => {
    mockTronGrid({ '/wallet/getaccount': ok(notActivated) });
    const r = await sim('TRX', { amount: 5 });
    expect(r.tron).toMatchObject({ recipientActivated: false, activationFeeTrx: 1, bandwidthBurnTrx: 0.1 });
    expect(r.feeNative).toBeCloseTo(1.1, 9);
    expect(r.notices).toEqual([{ level: 'warn', detail: 'tron_recipient_not_activated' }]);
    expect(isBlocked(r)).toBe(false);
  });

  it('non-activated recipient with staked bandwidth → only the 1 TRX creation fee', async () => {
    mockTronGrid({
      '/wallet/getaccount': ok(notActivated),
      '/wallet/getaccountresource': ok({ ...USER_RESOURCE, NetLimit: 5000, NetUsed: 100 }),
    });
    const r = await sim('TRX', { amount: 5 });
    expect(r.feeNative).toBeCloseTo(1, 9);
  });

  it('the creation fee counts toward the balance check', async () => {
    mockTronGrid({ '/wallet/getaccount': ok(notActivated) });
    const r = await sim('TRX', { amount: 14.5 }); // 14.5 + 1.1 > 15
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
  });
});

describe('wiring', () => {
  it('uses the stored wallet_tron_address when the caller does not pass one (send screen unchanged)', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => (k === 'wallet_tron_address' ? SENDER : null) } });
    const fetchMock = mockTronGrid();
    const r = await sim('TRC20', { fromTronAddress: undefined });
    expect(r.tron?.source).toBe('live');
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith('/wallet/getaccountresource'))!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ address: SENDER, visible: true });
  });

  it('non-TRON coins get no tron / notices fields', async () => {
    const r = await simulateTransfer({ coin: 'SOL', toAddress: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', amount: 1, balances: { ...BALANCES, SOL: 10 }, eurRates: RATES });
    expect(r).not.toHaveProperty('tron');
    expect(r).not.toHaveProperty('notices');
  });

  it('every detail has RU and EN text', () => {
    for (const key of Object.values(SIM_DETAIL_I18N)) {
      expect(translations.ru[key]).toBeTruthy();
      expect(translations.en[key]).toBeTruthy();
    }
  });

  it('estimateTronFee throws (caller falls back) on a bad sender address', async () => {
    await expect(estimateTronFee({ kind: 'usdt', from: 'nope', to: FRESH, amount: 1 })).rejects.toThrow();
  });
});

// ─── TRC-20 burn-on-revert: a reverting dry run blocks the send ──────────────

describe('USDT dry run reverted → BLOCKING', () => {
  it('real revert sample ("REVERT opcode executed", e.g. USDT below the amount) blocks with tron_estimate_revert', async () => {
    mockTronGrid({ '/wallet/triggerconstantcontract': ok(reverted.response) });
    const r = await sim('TRC20', { balances: { ...BALANCES, TRX: 1000 } });
    expect(r.warnings).toContainEqual({ level: 'block', code: 'simulation_failed', detail: 'tron_estimate_revert' });
    expect(r.warnings.some((w) => w.detail === 'tron_fee_estimate_unavailable')).toBe(false);
    expect(r.warnings.filter((w) => w.code === 'simulation_failed')).toHaveLength(1);
    expect(isBlocked(r)).toBe(true);
    expect(r.tron).toMatchObject({ source: 'static', unavailableReason: 'TRON_ESTIMATE_REVERT' });
    expect(r.feeNative).toBe(14); // the static fee is still shown
  });

  it('an assert failure (INVALID opcode) counts as a contract refusal too', async () => {
    const invalid = { ...reverted.response, result: { result: true, message: Buffer.from('Invalid operation code: opCode[fe];').toString('hex') } };
    mockTronGrid({ '/wallet/triggerconstantcontract': ok(invalid) });
    expect(isBlocked(await sim('TRC20', { balances: { ...BALANCES, TRX: 1000 } }))).toBe(true);
  });

  it('the revert text has RU and EN copy', () => {
    expect(SIM_DETAIL_I18N.tron_estimate_revert).toBe('simTronEstimateRevert');
    expect(translations.ru.simTronEstimateRevert).toContain('Отправка заблокирована');
    expect(translations.en.simTronEstimateRevert).toContain('Sending is blocked');
  });
});

// ─── TRX balance unknown to the caller: read it on chain inside the estimate ─

describe('TRX balance did not load (unknownBalances: TRX)', () => {
  /** Like mockTronGrid, but /wallet/getaccount answers per address (sender vs recipient). */
  function mockWithSender(sender: Reply, over: Record<string, Reply> = {}) {
    const recipient = ok({ address: HOLDER, balance: 5_000_000, create_time: 1629452451000 });
    const replies: Record<string, Reply> = {
      '/wallet/getchainparameters': ok(chainParams),
      '/wallet/getaccountresource': ok(USER_RESOURCE),
      '/wallet/triggerconstantcontract': ok(newHolder.response),
      ...over,
    };
    const fn = vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/wallet/getaccount') {
        const { address } = JSON.parse(String(init?.body)) as { address: string };
        return address === SENDER ? sender() : recipient();
      }
      const reply = replies[path];
      if (!reply) throw new Error(`unexpected call ${path}`);
      return reply();
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const senderAccount = (sun: number) => ok({ address: SENDER, balance: sun, create_time: 1629452451000 });
  const senderReads = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.filter((c) => (c[0] as string).endsWith('/wallet/getaccount') && JSON.parse(String(c[1]!.body)).address === SENDER);
  const unknownTrx = { unknownBalances: ['TRX'] as SimCoin[], balances: { ...BALANCES, TRX: 0 } };

  it('TRC-20: chain says 2 TRX, the live fee is 13.03 TRX → insufficient_fee_balance BLOCK, no balance_unknown', async () => {
    const fn = mockWithSender(senderAccount(2_000_000));
    const r = await sim('TRC20', unknownTrx);
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
    expect(r.warnings.some((w) => w.code === 'balance_unknown')).toBe(false);
    expect(isBlocked(r)).toBe(true);
    expect(senderReads(fn)).toHaveLength(1);
    expect(JSON.parse(String(senderReads(fn)[0][1]!.body))).toEqual({ address: SENDER, visible: true });
  });

  it('TRC-20: chain says 20 TRX → not blocked, no balance_unknown', async () => {
    mockWithSender(senderAccount(20_000_000));
    const r = await sim('TRC20', unknownTrx);
    expect(r.warnings).toEqual([]);
    expect(isBlocked(r)).toBe(false);
  });

  it('TRC-20: sender account not activated ({}) = 0 TRX → BLOCK', async () => {
    mockWithSender(ok(notActivated));
    expect((await sim('TRC20', unknownTrx)).warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
  });

  it('TRC-20: live estimate down (static 14 TRX) but the balance read works (2 TRX) → still BLOCK', async () => {
    mockWithSender(senderAccount(2_000_000), { '/wallet/getchainparameters': httpError(503) });
    const r = await sim('TRC20', unknownTrx);
    expect(r.feeNative).toBe(14);
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
  });

  it('the balance read fails too → the old non-blocking balance_unknown warning', async () => {
    mockWithSender(httpError(503));
    const r = await sim('TRC20', unknownTrx);
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'balance_unknown' });
    expect(r.warnings.some((w) => w.code === 'insufficient_fee_balance')).toBe(false);
    expect(isBlocked(r)).toBe(false);
  });

  it('a hanging balance read does not hang the review', async () => {
    mockWithSender(hang);
    const r = await sim('TRC20', { ...unknownTrx, timeoutMs: 200 });
    expect(r.status).toBe('ok');
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'balance_unknown' });
  });

  it('TRX send: chain balance 3 TRX, amount 5 → insufficient_funds BLOCK (same-currency rule)', async () => {
    mockWithSender(senderAccount(3_000_000));
    const r = await sim('TRX', { ...unknownTrx, toAddress: HOLDER, amount: 5 });
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
    expect(r.warnings.some((w) => w.code === 'balance_unknown')).toBe(false);
    expect(r.balanceAfter).toBeNull();
  });

  it('TRX send: chain balance 50 TRX → ok, balanceAfter from the chain balance', async () => {
    mockWithSender(senderAccount(50_000_000));
    const r = await sim('TRX', { ...unknownTrx, toAddress: HOLDER, amount: 5 });
    expect(isBlocked(r)).toBe(false);
    expect(r.balanceAfter).toBeCloseTo(45, 9);
  });

  it('only TRC20 unknown (TRX loaded): no extra balance read', async () => {
    const fn = mockWithSender(senderAccount(1));
    await sim('TRC20', { unknownBalances: ['TRC20'] });
    expect(senderReads(fn)).toHaveLength(0);
  });
});
