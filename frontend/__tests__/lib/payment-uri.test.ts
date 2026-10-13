import { describe, it, expect } from 'vitest';
import { buildPaymentUri, decimalToUnits, normalizeDecimal } from '@/lib/payment-uri';

const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ETH = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const TON = 'UQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M-';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TRON = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';

describe('buildPaymentUri', () => {
  it('BTC: BIP 21 with and without amount', () => {
    expect(buildPaymentUri('BTC', BTC)).toBe(`bitcoin:${BTC}`);
    expect(buildPaymentUri('BTC', BTC, '')).toBe(`bitcoin:${BTC}`);
    expect(buildPaymentUri('BTC', BTC, '0.001')).toBe(`bitcoin:${BTC}?amount=0.001`);
    expect(buildPaymentUri('BTC', BTC, '.50')).toBe(`bitcoin:${BTC}?amount=0.5`);
    expect(buildPaymentUri('BTC', BTC, '0')).toBe(`bitcoin:${BTC}`);
  });

  it('ETH: EIP 681 value in wei (integer string), raw address without amount', () => {
    expect(buildPaymentUri('ETH', ETH)).toBe(ETH);
    expect(buildPaymentUri('ETH', ETH, '1.5')).toBe(`ethereum:${ETH}@1?value=1500000000000000000`);
    expect(buildPaymentUri('ETH', ETH, '0.3')).toBe(`ethereum:${ETH}@1?value=300000000000000000`); // 0.1+0.2 trap
    expect(buildPaymentUri('ETH', ETH, '0.000000000000000001')).toBe(`ethereum:${ETH}@1?value=1`);
  });

  it('TON: ton://transfer with nanotons; the path is always the url-safe address', () => {
    expect(buildPaymentUri('TON', TON)).toBe(`ton://transfer/${TON}`);
    expect(buildPaymentUri('TON', TON, '1.5')).toBe(`ton://transfer/${TON}?amount=1500000000`);
    expect(buildPaymentUri('TON', 'EQab+cd/ef', '2')).toBe('ton://transfer/EQab-cd_ef?amount=2000000000');
  });

  it('SOL: Solana Pay amount in SOL, raw address without amount', () => {
    expect(buildPaymentUri('SOL', SOL)).toBe(SOL);
    expect(buildPaymentUri('SOL', SOL, '0.25')).toBe(`solana:${SOL}?amount=0.25`);
  });

  it('USDT (all networks) and TRX: always the raw address', () => {
    for (const coin of ['USDT', 'TRC20', 'USDT_TON', 'TRX'] as const) {
      const addr = coin === 'USDT' ? ETH : coin === 'USDT_TON' ? TON : TRON;
      expect(buildPaymentUri(coin, addr)).toBe(addr);
      expect(buildPaymentUri(coin, addr, '10')).toBe(addr);
    }
  });

  it('an amount the coin cannot represent is dropped, never rounded', () => {
    expect(buildPaymentUri('BTC', BTC, '0.000000001')).toBe(`bitcoin:${BTC}`); // 9 decimals
    expect(buildPaymentUri('ETH', ETH, '1.' + '1'.repeat(19))).toBe(ETH);
    expect(buildPaymentUri('TON', TON, 'abc')).toBe(`ton://transfer/${TON}`);
    expect(buildPaymentUri('BTC', '')).toBe('');
  });
});

describe('decimal helpers (BigInt, no floats)', () => {
  it('decimalToUnits is exact for large and tiny values', () => {
    expect(decimalToUnits('123456789.123456789123456789', 18)).toBe('123456789123456789123456789');
    expect(decimalToUnits('0.000000001', 9)).toBe('1');
    expect(decimalToUnits('1', 9)).toBe('1000000000');
    expect(decimalToUnits('0', 9)).toBeNull();
  });

  it('normalizeDecimal canonicalizes typed input', () => {
    expect(normalizeDecimal('007.10', 8)).toBe('7.1');
    expect(normalizeDecimal('1.', 8)).toBe('1');
    expect(normalizeDecimal('.', 8)).toBeNull();
    expect(normalizeDecimal('1e-7', 8)).toBeNull();
    expect(normalizeDecimal('1,5', 8)).toBeNull();
  });
});
