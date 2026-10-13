// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { secp256k1 } from '@noble/curves/secp256k1';
import trxFx from './fixtures/tron/createtransaction.json';
import usdtFx from './fixtures/tron/triggersmartcontract.json';
import {
  decodeTronRawData,
  verifyTronTransaction,
  TronTxMismatchError,
  type TronTxExpectation,
  type TronTxMismatchReason,
  sendTrxRaw,
  sendUsdtTrc20Raw,
  tronAddressFromPrivKey,
  isValidTronAddress,
  toTronBaseUnits,
} from '@/lib/crypto/tron-tx';

// Count signatures without changing them (the noble curve object is frozen, so no spyOn).
const signCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@noble/curves/secp256k1', async (importOriginal) => {
  const real = await importOriginal<typeof import('@noble/curves/secp256k1')>();
  const sign: typeof real.secp256k1.sign = (...args) => {
    signCalls.n += 1;
    return real.secp256k1.sign(...args);
  };
  return { ...real, secp256k1: { ...real.secp256k1, sign } };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

const sha256hex = (hex: string) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const hex21 = (addr: string) => Buffer.from(bs58.decode(addr).slice(0, 21)).toString('hex');
const utf8hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/** Minimal protobuf encoder (test-only) to build synthetic variants and re-encode the fixtures. */
function varint(v: bigint | number): string {
  let x = BigInt.asUintN(64, BigInt(v));
  let out = '';
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    out += b.toString(16).padStart(2, '0');
  } while (x);
  return out;
}
const fVar = (n: number, v: bigint | number) => varint((n << 3) | 0) + varint(v);
const fBytes = (n: number, hex: string) => varint((n << 3) | 2) + varint(hex.length / 2) + hex;

type RawParts = {
  refBlockBytes: string; refBlockHash: string; expiration: number; timestamp: number;
  contract: string; feeLimit?: number; memoHex?: string;
};
const buildRaw = (p: RawParts) =>
  fBytes(1, p.refBlockBytes) + fBytes(4, p.refBlockHash) + fVar(8, p.expiration) +
  (p.memoHex !== undefined ? fBytes(10, p.memoHex) : '') +
  fBytes(11, p.contract) + fVar(14, p.timestamp) +
  (p.feeLimit !== undefined ? fVar(18, p.feeLimit) : '');
const buildContract = (type: number, typeUrl: string, valueHex: string, extra = '') =>
  fVar(1, type) + fBytes(2, fBytes(1, utf8hex(typeUrl)) + fBytes(2, valueHex)) + extra;
const TRIGGER_URL = 'type.googleapis.com/protocol.TriggerSmartContract';
const TRANSFER_URL = 'type.googleapis.com/protocol.TransferContract';

const asTx = (raw: string) => ({ raw_data_hex: raw, txID: sha256hex(raw), visible: false });

/** Same tx with raw bytes edited and a matching txID, so only the targeted check can fail. */
function tamper(tx: { raw_data_hex: string }, edit: (raw: string) => string) {
  const raw = edit(tx.raw_data_hex);
  expect(raw).not.toBe(tx.raw_data_hex); // the edit really applied
  return { ...tx, raw_data_hex: raw, txID: sha256hex(raw) };
}

function expectReject(fn: () => unknown, reason: TronTxMismatchReason) {
  let err: unknown;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(TronTxMismatchError);
  expect((err as TronTxMismatchError).reason).toBe(reason);
}

// ─── fixtures (real unsigned TronGrid responses) ─────────────────────────────

const TRX_TX = trxFx.response;
const USDT_TX = usdtFx.response.transaction;
const TRX_NOW = TRX_TX.raw_data.expiration - 30_000;
const USDT_NOW = USDT_TX.raw_data.expiration - 30_000;
const OTHER_HEX = hex21('TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi');
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

const TRX_EXP: TronTxExpectation = {
  kind: 'trx', ownerHex: hex21(trxFx.owner), toHex: hex21(trxFx.to),
  amount: BigInt(trxFx.amount_sun), feeLimitSun: 0n,
};
const USDT_EXP: TronTxExpectation = {
  kind: 'usdt', ownerHex: hex21(usdtFx.owner), toHex: hex21(usdtFx.to),
  amount: BigInt(usdtFx.amount_units), feeLimitSun: 30_000_000n,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── decoder vs real samples ──────────────────────────────────────────────────

describe('decodeTronRawData against real TronGrid samples', () => {
  it('txID of both samples is sha256(raw_data_hex), i.e. the digest we sign', () => {
    expect(sha256hex(TRX_TX.raw_data_hex)).toBe(TRX_TX.txID);
    expect(sha256hex(USDT_TX.raw_data_hex)).toBe(USDT_TX.txID);
  });

  it('createtransaction (TransferContract): every field matches the JSON raw_data TronGrid sent', () => {
    const d = decodeTronRawData(TRX_TX.raw_data_hex);
    const j = TRX_TX.raw_data;
    const v = j.contract[0].parameter.value;
    expect(d.refBlockBytesHex).toBe(j.ref_block_bytes);
    expect(d.refBlockHashHex).toBe(j.ref_block_hash);
    expect(d.expiration).toBe(BigInt(j.expiration));
    expect(d.timestamp).toBe(BigInt(j.timestamp));
    expect(d.feeLimit).toBeUndefined();
    expect(d.dataHex).toBeUndefined();
    expect(d.authsCount).toBe(0);
    expect(d.contracts).toHaveLength(1);
    expect(d.contracts[0]).toMatchObject({
      type: 1,
      typeUrl: j.contract[0].parameter.type_url,
      ownerHex: v.owner_address,
      toHex: v.to_address,
      amount: BigInt(v.amount),
      permissionId: 0,
      hasProvider: false,
      hasContractName: false,
    });
  });

  it('triggersmartcontract (TriggerSmartContract): every field matches the JSON raw_data', () => {
    const d = decodeTronRawData(USDT_TX.raw_data_hex);
    const j = USDT_TX.raw_data;
    const v = j.contract[0].parameter.value;
    expect(d.refBlockBytesHex).toBe(j.ref_block_bytes);
    expect(d.refBlockHashHex).toBe(j.ref_block_hash);
    expect(d.expiration).toBe(BigInt(j.expiration));
    expect(d.timestamp).toBe(BigInt(j.timestamp));
    expect(d.feeLimit).toBe(BigInt(j.fee_limit));
    expect(d.contracts).toHaveLength(1);
    expect(d.contracts[0]).toMatchObject({
      type: 31,
      typeUrl: j.contract[0].parameter.type_url,
      ownerHex: v.owner_address,
      contractHex: v.contract_address,
      dataHex: v.data,
      callValue: 0n,
      callTokenValue: 0n,
      tokenId: 0n,
    });
  });

  it('re-encoding the decoded fields reproduces both samples byte for byte (no field missed)', () => {
    const t = TRX_TX.raw_data;
    const tv = t.contract[0].parameter.value;
    const trxRaw = buildRaw({
      refBlockBytes: t.ref_block_bytes, refBlockHash: t.ref_block_hash,
      expiration: t.expiration, timestamp: t.timestamp,
      contract: buildContract(1, TRANSFER_URL,
        fBytes(1, tv.owner_address) + fBytes(2, tv.to_address) + fVar(3, tv.amount)),
    });
    expect(trxRaw).toBe(TRX_TX.raw_data_hex);

    const u = USDT_TX.raw_data;
    const uv = u.contract[0].parameter.value;
    const usdtRaw = buildRaw({
      refBlockBytes: u.ref_block_bytes, refBlockHash: u.ref_block_hash,
      expiration: u.expiration, timestamp: u.timestamp, feeLimit: u.fee_limit,
      contract: buildContract(31, TRIGGER_URL,
        fBytes(1, uv.owner_address) + fBytes(2, uv.contract_address) + fBytes(4, uv.data)),
    });
    expect(usdtRaw).toBe(USDT_TX.raw_data_hex);
  });
});

// ─── verifyTronTransaction ────────────────────────────────────────────────────

describe('verifyTronTransaction: TRX (createtransaction)', () => {
  it('accepts the genuine transaction and returns the bytes whose sha256 is the txID', () => {
    const v = verifyTronTransaction(TRX_TX, TRX_EXP, TRX_NOW);
    expect(v.txID).toBe(TRX_TX.txID);
    expect(sha256hex(Buffer.from(v.rawBytes).toString('hex'))).toBe(TRX_TX.txID);
  });

  it('txID compare is case-insensitive', () => {
    expect(() => verifyTronTransaction({ ...TRX_TX, txID: TRX_TX.txID.toUpperCase() }, TRX_EXP, TRX_NOW)).not.toThrow();
  });

  it('rejects a wrong txID', () => {
    expectReject(() => verifyTronTransaction({ ...TRX_TX, txID: USDT_TX.txID }, TRX_EXP, TRX_NOW), 'txid');
  });

  it('rejects a tampered recipient', () => {
    const tx = tamper(TRX_TX, (r) => r.replace(TRX_EXP.toHex, OTHER_HEX));
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'recipient');
  });

  it('rejects a tampered owner', () => {
    const tx = tamper(TRX_TX, (r) => r.replace(TRX_EXP.ownerHex, OTHER_HEX));
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'owner');
  });

  it('rejects a tampered amount', () => {
    // amount 1234567 = varint 87 ad 4b; 88 ad 4b is a different amount of the same length
    const tx = tamper(TRX_TX, (r) => r.replace('1887ad4b', '1888ad4b'));
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'amount');
  });

  it('rejects an extra contract', () => {
    const d = TRX_TX.raw_data_hex;
    const start = d.indexOf('5a67');
    const contractField = d.slice(start, start + 4 + 0x67 * 2);
    const tx = tamper(TRX_TX, (r) => r + contractField);
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'contract_count');
  });

  it('rejects a memo (data field) the wallet did not set', () => {
    const tx = tamper(TRX_TX, (r) => r + fBytes(10, utf8hex('hi')));
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'extra_field');
  });

  it('rejects unknown protobuf fields and auths/scripts', () => {
    expectReject(() => verifyTronTransaction(tamper(TRX_TX, (r) => r + fVar(99, 1)), TRX_EXP, TRX_NOW), 'extra_field');
    expectReject(() => verifyTronTransaction(tamper(TRX_TX, (r) => r + fBytes(9, '0a00')), TRX_EXP, TRX_NOW), 'extra_field');
    expectReject(() => verifyTronTransaction(tamper(TRX_TX, (r) => r + fBytes(12, '00')), TRX_EXP, TRX_NOW), 'extra_field');
  });

  it('rejects any fee_limit on a plain TRX transfer', () => {
    const tx = tamper(TRX_TX, (r) => r + fVar(18, 1));
    expectReject(() => verifyTronTransaction(tx, TRX_EXP, TRX_NOW), 'fee_limit');
  });

  it('rejects expired and too-far-future transactions', () => {
    expectReject(() => verifyTronTransaction(TRX_TX, TRX_EXP, TRX_TX.raw_data.expiration + 10 * 60_000), 'expiration');
    expectReject(() => verifyTronTransaction(TRX_TX, TRX_EXP, TRX_TX.raw_data.expiration - 25 * 3600_000), 'expiration');
  });

  it('rejects a USDT contract call presented for a TRX send', () => {
    const exp = { ...TRX_EXP, ownerHex: USDT_EXP.ownerHex, feeLimitSun: 30_000_000n };
    expectReject(() => verifyTronTransaction(USDT_TX, exp, USDT_NOW), 'contract_type');
  });

  it('rejects malformed input instead of signing garbage', () => {
    expectReject(() => verifyTronTransaction(null, TRX_EXP, TRX_NOW), 'format');
    expectReject(() => verifyTronTransaction({ txID: TRX_TX.txID }, TRX_EXP, TRX_NOW), 'format');
    const notHex = TRX_TX.raw_data_hex.slice(0, -2) + 'zz';
    expectReject(() => verifyTronTransaction({ raw_data_hex: notHex, txID: TRX_TX.txID }, TRX_EXP, TRX_NOW), 'format');
    const odd = TRX_TX.raw_data_hex + '0';
    expectReject(() => verifyTronTransaction({ raw_data_hex: odd, txID: TRX_TX.txID }, TRX_EXP, TRX_NOW), 'format');
    // truncated inside the contract → length prefix runs past the end
    expectReject(() => verifyTronTransaction(asTx(TRX_TX.raw_data_hex.slice(0, 60)), TRX_EXP, TRX_NOW), 'format');
  });
});

describe('verifyTronTransaction: USDT TRC-20 (triggersmartcontract)', () => {
  it('accepts the genuine transaction', () => {
    expect(verifyTronTransaction(USDT_TX, USDT_EXP, USDT_NOW).txID).toBe(USDT_TX.txID);
  });

  it('rejects a tampered recipient inside the call data', () => {
    const tx = tamper(USDT_TX, (r) => r.replace(USDT_EXP.toHex.slice(2), OTHER_HEX.slice(2)));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'recipient');
  });

  it('rejects a tampered amount', () => {
    const tx = tamper(USDT_TX, (r) => r.replace('00000000002625a0', '00000000002625a1'));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'amount');
  });

  it('rejects a different token contract', () => {
    const tx = tamper(USDT_TX, (r) => r.replace(USDT_HEX, OTHER_HEX));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'token_contract');
  });

  it('rejects approve(spender, amount) (selector 095ea7b3) dressed as the transfer', () => {
    const tx = tamper(USDT_TX, (r) => r.replace('a9059cbb', '095ea7b3'));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'call_data');
  });

  it('rejects a fee_limit above the one requested', () => {
    // 30_000_000 = varint 80 87 a7 0e; ff ff ff 7f = 268_435_455 sun (same length)
    const tx = tamper(USDT_TX, (r) => r.replace('90018087a70e', '9001ffffff7f'));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'fee_limit');
  });

  it('rejects a changed owner', () => {
    const tx = tamper(USDT_TX, (r) => r.replace(USDT_EXP.ownerHex, OTHER_HEX));
    expectReject(() => verifyTronTransaction(tx, USDT_EXP, USDT_NOW), 'owner');
  });

  it('rejects TRX or TRC-10 tokens attached to the call', () => {
    const u = USDT_TX.raw_data;
    const v = u.contract[0].parameter.value;
    const base = { refBlockBytes: u.ref_block_bytes, refBlockHash: u.ref_block_hash, expiration: u.expiration, timestamp: u.timestamp, feeLimit: u.fee_limit };
    const withCallValue = buildRaw({ ...base, contract: buildContract(31, TRIGGER_URL,
      fBytes(1, v.owner_address) + fBytes(2, v.contract_address) + fVar(3, 1_000_000) + fBytes(4, v.data)) });
    expectReject(() => verifyTronTransaction(asTx(withCallValue), USDT_EXP, USDT_NOW), 'call_value');
    const withToken = buildRaw({ ...base, contract: buildContract(31, TRIGGER_URL,
      fBytes(1, v.owner_address) + fBytes(2, v.contract_address) + fBytes(4, v.data) + fVar(5, 5) + fVar(6, 1002000)) });
    expectReject(() => verifyTronTransaction(asTx(withToken), USDT_EXP, USDT_NOW), 'call_value');
  });

  it('rejects a non-owner Permission_id, provider and a wrong type_url', () => {
    const u = USDT_TX.raw_data;
    const v = u.contract[0].parameter.value;
    const base = { refBlockBytes: u.ref_block_bytes, refBlockHash: u.ref_block_hash, expiration: u.expiration, timestamp: u.timestamp, feeLimit: u.fee_limit };
    const value = fBytes(1, v.owner_address) + fBytes(2, v.contract_address) + fBytes(4, v.data);
    expectReject(() => verifyTronTransaction(asTx(buildRaw({ ...base, contract: buildContract(31, TRIGGER_URL, value, fVar(5, 2)) })), USDT_EXP, USDT_NOW), 'extra_field');
    expectReject(() => verifyTronTransaction(asTx(buildRaw({ ...base, contract: buildContract(31, TRIGGER_URL, value, fBytes(3, '01')) })), USDT_EXP, USDT_NOW), 'extra_field');
    expectReject(() => verifyTronTransaction(asTx(buildRaw({ ...base, contract: buildContract(31, 'evil.example/protocol.TriggerSmartContract', value) })), USDT_EXP, USDT_NOW), 'contract_type');
  });

  it('the synthetic encoder reproduces the genuine tx, so the variants above differ only where intended', () => {
    const u = USDT_TX.raw_data;
    const v = u.contract[0].parameter.value;
    const genuine = buildRaw({ refBlockBytes: u.ref_block_bytes, refBlockHash: u.ref_block_hash, expiration: u.expiration, timestamp: u.timestamp, feeLimit: u.fee_limit,
      contract: buildContract(31, TRIGGER_URL, fBytes(1, v.owner_address) + fBytes(2, v.contract_address) + fBytes(4, v.data)) });
    expect(() => verifyTronTransaction(asTx(genuine), USDT_EXP, USDT_NOW)).not.toThrow();
  });
});

// ─── send paths: verify before signing, never sign on mismatch ───────────────

const PRIV = Uint8Array.from(createHash('sha256').update('neurowallet-tron-test-key').digest());
const ME = tronAddressFromPrivKey(PRIV);
const ME_HEX = hex21(ME);

/** The real build response, re-owned to the test key (txID recomputed). */
function ownedBy(tx: { raw_data_hex: string }, fromHex: string) {
  return tamper(tx, (r) => r.replace(fromHex, ME_HEX));
}

function mockTronGrid(buildResponse: unknown) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/wallet/broadcasttransaction')) {
      return { ok: true, json: async () => ({ result: true, txid: 'node-echo' }) };
    }
    return { ok: true, json: async () => buildResponse };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fn: ReturnType<typeof mockTronGrid>, i: number) => String(fn.mock.calls[i][1]?.body);

function expectValidSignature(body: { txID: string; signature: string[] }) {
  const sigHex = body.signature[0];
  expect(sigHex).toMatch(/^[0-9a-f]{130}$/);
  const sig = secp256k1.Signature.fromCompact(sigHex.slice(0, 128)).addRecoveryBit(parseInt(sigHex.slice(128), 16));
  const pub = sig.recoverPublicKey(Buffer.from(body.txID, 'hex')).toRawBytes(false);
  expect(Buffer.from(pub).toString('hex')).toBe(Buffer.from(secp256k1.getPublicKey(PRIV, false)).toString('hex'));
}

describe('sendTrxRaw / sendUsdtTrc20Raw', () => {
  it('TRX: signs the verified txID and returns it (not the node echo)', async () => {
    const tx = ownedBy(TRX_TX, TRX_EXP.ownerHex);
    vi.spyOn(Date, 'now').mockReturnValue(TRX_NOW);
    const fetchMock = mockTronGrid(tx);
    signCalls.n = 0;
    const id = await sendTrxRaw(PRIV, trxFx.to, 1.234567);
    expect(id).toBe(tx.txID);
    expect(signCalls.n).toBe(1);
    const build = JSON.parse(bodyOf(fetchMock, 0));
    expect(build).toMatchObject({ owner_address: ME_HEX, to_address: TRX_EXP.toHex, amount: 1_234_567, visible: false });
    const broadcast = JSON.parse(bodyOf(fetchMock, 1));
    expect(broadcast.txID).toBe(tx.txID);
    expect(broadcast.raw_data_hex).toBe(tx.raw_data_hex);
    expectValidSignature(broadcast);
  });

  it('TRX: a node-swapped recipient is rejected and nothing is signed or broadcast', async () => {
    const tx = tamper(ownedBy(TRX_TX, TRX_EXP.ownerHex), (r) => r.replace(TRX_EXP.toHex, OTHER_HEX));
    vi.spyOn(Date, 'now').mockReturnValue(TRX_NOW);
    const fetchMock = mockTronGrid(tx);
    signCalls.n = 0;
    await expect(sendTrxRaw(PRIV, trxFx.to, 1.234567)).rejects.toBeInstanceOf(TronTxMismatchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signCalls.n).toBe(0);
  });

  it('USDT: builds transfer(address,uint256) with fee_limit 30 TRX, verifies and signs', async () => {
    const tx = ownedBy(USDT_TX, USDT_EXP.ownerHex);
    vi.spyOn(Date, 'now').mockReturnValue(USDT_NOW);
    const fetchMock = mockTronGrid({ result: { result: true }, transaction: tx });
    const id = await sendUsdtTrc20Raw(PRIV, usdtFx.to, 2.5);
    expect(id).toBe(tx.txID);
    const build = JSON.parse(bodyOf(fetchMock, 0));
    expect(build).toMatchObject({
      owner_address: ME_HEX,
      contract_address: USDT_HEX,
      data: USDT_TX.raw_data.contract[0].parameter.value.data,
      fee_limit: 30_000_000,
      call_value: 0,
      visible: false,
    });
    expectValidSignature(JSON.parse(bodyOf(fetchMock, 1)));
  });

  it('USDT: an approve() swapped in by the node is rejected before signing', async () => {
    const tx = tamper(ownedBy(USDT_TX, USDT_EXP.ownerHex), (r) => r.replace('a9059cbb', '095ea7b3'));
    vi.spyOn(Date, 'now').mockReturnValue(USDT_NOW);
    const fetchMock = mockTronGrid({ result: { result: true }, transaction: tx });
    signCalls.n = 0;
    await expect(sendUsdtTrc20Raw(PRIV, usdtFx.to, 2.5)).rejects.toMatchObject({ reason: 'call_data' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signCalls.n).toBe(0);
  });
});

// ─── task 2: USDT TRC-20 input validation ─────────────────────────────────────

describe('USDT TRC-20 send input validation', () => {
  /** base58check with an arbitrary version byte. */
  const withVersion = (version: number, body20: Buffer) => {
    const payload = Buffer.concat([Buffer.from([version]), body20]);
    const chk = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
    return bs58.encode(Buffer.concat([payload, chk]));
  };

  it('isValidTronAddress requires the 0x41 version byte, not just a "T…" checksum-valid string', () => {
    const body = Buffer.from(USDT_HEX.slice(2), 'hex');
    const wrongVersion = withVersion(0x42, body);
    expect(wrongVersion).toMatch(/^T/);
    expect(wrongVersion).toHaveLength(34);
    expect(isValidTronAddress(wrongVersion)).toBe(false);
    expect(isValidTronAddress(withVersion(0x41, body))).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['0x' + 'a'.repeat(40), 'ETH address'],
    ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u', 'bad checksum'],
    ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6', 'too short'],
  ])('rejects recipient %s (%s) before any network call', async (addr) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendUsdtTrc20Raw(PRIV, addr, 1)).rejects.toThrow('Неверный TRON-адрес');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a recipient with the wrong version byte', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendUsdtTrc20Raw(PRIV, withVersion(0x42, Buffer.alloc(20, 7)), 1)).rejects.toThrow('Неверный TRON-адрес');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 1.1234567, 0.0000001])('rejects amount %s before any network call', async (amount) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendUsdtTrc20Raw(PRIV, usdtFx.to, amount)).rejects.toThrow(/Сумма/);
    await expect(sendTrxRaw(PRIV, trxFx.to, amount)).rejects.toThrow(/Сумма/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('toTronBaseUnits: exact 6-decimal conversion', () => {
    expect(toTronBaseUnits(10.5)).toBe(10_500_000n);
    expect(toTronBaseUnits(0.000001)).toBe(1n);
    expect(toTronBaseUnits(2.5)).toBe(2_500_000n);
    expect(toTronBaseUnits(123456.789012)).toBe(123_456_789_012n);
    expect(toTronBaseUnits(0.3)).toBe(300_000n);
  });
});
