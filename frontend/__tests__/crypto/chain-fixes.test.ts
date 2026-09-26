import { describe, it, expect } from 'vitest';
import { tonMsgOp, isJettonServiceMsg, sameTonAddress, toFriendlyTon } from '@/lib/server/ton-history-parse';
import { tronBroadcastError } from '@/lib/crypto/tron-tx';
import { isValidBtcAddress } from '@/lib/crypto/btc-tx';
import { Address } from '@ton/ton';

const USDT_TON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

describe('TON history parsing (toncenter v2 msg_data is an object)', () => {
  const jettonTransfer = { '@type': 'msg.dataRaw', body: 'te6cckEBAQEADgAAGA+KfqUAAAAAAAAAANvuIqo=' };
  const textComment = { '@type': 'msg.dataRaw', body: 'te6cckEBAQEACAAADAAAAABoaeh7Muk=' };

  it('reads the op code from the BoC body', () => {
    expect(tonMsgOp(jettonTransfer)).toBe(0x0f8a7ea5);
    expect(tonMsgOp(textComment)).toBe(0);
  });

  it('skips only jetton service messages, keeps plain transfers and comments', () => {
    expect(isJettonServiceMsg(jettonTransfer)).toBe(true);
    expect(isJettonServiceMsg(textComment)).toBe(false);
    expect(isJettonServiceMsg({ '@type': 'msg.dataText', text: 'aGk=' })).toBe(false);
    expect(isJettonServiceMsg(undefined)).toBe(false);
    expect(isJettonServiceMsg('0f8a7ea5')).toBe(false); // legacy string shape never crashes
  });

  it('compares raw (tonapi) and friendly addresses as the same account', () => {
    const raw = Address.parse(USDT_TON_MASTER).toRawString(); // 0:<hex>, как отдаёт tonapi
    expect(sameTonAddress(raw, USDT_TON_MASTER)).toBe(true);
    expect(sameTonAddress(raw, toFriendlyTon(USDT_TON_MASTER))).toBe(true);
    expect(sameTonAddress('garbage', USDT_TON_MASTER)).toBe(false);
    expect(sameTonAddress(undefined, USDT_TON_MASTER)).toBe(false);
  });
});

describe('tronBroadcastError', () => {
  it('decodes hex-encoded TronGrid messages', () => {
    const hex = Buffer.from('balance is not sufficient').toString('hex');
    expect(tronBroadcastError({ message: hex })).toBe('balance is not sufficient');
  });
  it('passes through plain codes and falls back when empty', () => {
    expect(tronBroadcastError({ code: 'SIGERROR' })).toBe('SIGERROR');
    expect(tronBroadcastError({})).toBe('Ошибка отправки в сеть Tron.');
  });
});

describe('BTC recipient validation', () => {
  it('accepts taproot (bc1p) recipients — ECC lib initialised', () => {
    expect(isValidBtcAddress('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr')).toBe(true);
  });
  it('still accepts segwit and rejects garbage', () => {
    expect(isValidBtcAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(true);
    expect(isValidBtcAddress('bc1pinvalid')).toBe(false);
  });
});
