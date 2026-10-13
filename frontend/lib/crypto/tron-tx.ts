/**
 * lib/crypto/tron-tx.ts
 * TRX and USDT TRC-20 on Tron via TronGrid public API.
 *
 * Key derivation: BIP44 m/44'/195'/0'/0/0  (secp256k1, same curve as ETH/BTC)
 * Address format: base58check(0x41 || keccak256(uncompressedPub[1:])[12:])
 * Signing:        SHA256(raw_data_hex_bytes)  (NOT keccak256 like ETH)
 * Transport:      TronGrid REST API. Balances go through /api/balances with a
 *                 server-side TRONGRID_API_KEY when configured; direct keyless
 *                 calls are the fallback (and are used for build/broadcast).
 * No blind signing: TronGrid builds the transaction, but its raw_data_hex is
 *                 decoded locally (protobuf) and compared with what the user
 *                 asked for BEFORE the key signs it (verifyTronTransaction).
 *
 * USDT contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (6 decimals)
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { BroadcastOutcomeUnknownError } from './broadcast-error';

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID = 'https://api.trongrid.io';

/** fee_limit of a USDT TRC-20 transfer, in sun (30 TRX). Caps the energy the tx may consume. */
export const USDT_TRC20_FEE_LIMIT_SUN = 30_000_000;

/** Mainnet address version byte (base58 "T…"). */
const TRON_ADDRESS_VERSION = 0x41;

// ─── Hashing / hex helpers ────────────────────────────────────────────────────

function sha256b(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.sha256(data));
}

function keccak256b(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.keccak256(data));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// ─── Address derivation ───────────────────────────────────────────────────────

function base58checkEncode(payload: Uint8Array): string {
  const chk = sha256b(sha256b(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(chk, payload.length);
  return bs58.encode(full);
}

/**
 * Derive Tron base58 address from a 32-byte secp256k1 private key.
 * Algorithm: keccak256(uncompressedPub[1:])[12:] → 20 bytes → prefix 0x41
 */
export function tronAddressFromPrivKey(privKey: Uint8Array): string {
  const uncompressedPub = secp256k1.getPublicKey(privKey, false); // 65 bytes
  const pubHash         = keccak256b(uncompressedPub.slice(1));   // 32 bytes
  const payload         = new Uint8Array(21);
  payload[0]            = TRON_ADDRESS_VERSION;                   // mainnet prefix
  payload.set(pubHash.slice(12), 1);                               // last 20 bytes
  return base58checkEncode(payload);
}

// ─── Address validation ───────────────────────────────────────────────────────

/**
 * base58check, "T…", 34 chars, 25 bytes, version byte 0x41. The version check
 * matters: a 34-char "T…" string with a valid checksum can decode to 0x42–0x44.
 */
export function isValidTronAddress(addr: string): boolean {
  if (typeof addr !== 'string' || !addr.startsWith('T') || addr.length !== 34) return false;
  try {
    const decoded = bs58.decode(addr);
    if (decoded.length !== 25 || decoded[0] !== TRON_ADDRESS_VERSION) return false;
    const payload   = decoded.slice(0, 21);
    const checksum  = decoded.slice(21);
    const computed  = sha256b(sha256b(payload));
    return checksum[0] === computed[0] && checksum[1] === computed[1]
        && checksum[2] === computed[2] && checksum[3] === computed[3];
  } catch {
    return false;
  }
}

// ─── Address ↔ hex (TronGrid uses hex for addresses in JSON) ─────────────────

/** "T…" → 21-byte hex "41…" (lowercase). Caller validates the address first. */
function tronAddrToHex(addr: string): string {
  return bytesToHex(bs58.decode(addr).slice(0, 21));
}

// ─── Amounts ──────────────────────────────────────────────────────────────────

/**
 * Human amount → integer base units (6 decimals: TRX in sun, USDT TRC-20 units).
 * Throws on NaN/∞, ≤ 0, more than 6 decimals or an amount too large to be exact.
 * Previously the amount was Math.round-ed silently.
 */
export function toTronBaseUnits(amount: number): bigint {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Сумма должна быть больше нуля.');
  }
  const scaled = Math.round(amount * 1e6);
  if (!Number.isSafeInteger(scaled)) throw new Error('Сумма слишком большая.');
  if (scaled / 1e6 !== amount) throw new Error('Сумма: не больше 6 знаков после запятой.');
  return BigInt(scaled);
}

// ─── ABI-encode transfer(address,uint256) for USDT TRC-20 ────────────────────

/** @param toHex 21-byte "41…" hex of the recipient; @param units amount in base units. */
function buildTransferData(toHex: string, units: bigint): string {
  // Function selector: keccak256("transfer(address,uint256)") → a9059cbb
  const selector = 'a9059cbb';
  // Tron address in ABI = strip the 0x41 byte → 20 bytes, left-padded to 32
  const paddedAddr = '0'.repeat(24) + toHex.slice(2);
  const paddedAmt = units.toString(16).padStart(64, '0');
  return selector + paddedAddr + paddedAmt;
}

// ─── Balance ──────────────────────────────────────────────────────────────────

export interface TronAccountBalances { trx: number; usdtTrc: number }

function malformed(what: string): Error {
  return new Error(`TronGrid: malformed response (${what})`);
}

/**
 * Parse TronGrid /v1/accounts/{addr}. A non-activated account (`data: []`)
 * is a genuine zero. Anything else that does not look like an account
 * response (API error field, missing `data`, non-numeric balances) THROWS,
 * so callers can show "unavailable" instead of a fake 0.
 */
export function parseTronAccount(data: unknown): TronAccountBalances {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed('body');
  const body = data as { success?: unknown; error?: unknown; data?: unknown };
  if (body.success === false || body.error !== undefined) {
    throw new Error(`TronGrid error: ${String(body.error ?? 'success=false').slice(0, 120)}`);
  }
  if (!Array.isArray(body.data)) throw malformed('data');
  const account = body.data[0] as unknown;
  if (account === undefined) return { trx: 0, usdtTrc: 0 };          // not activated
  if (!account || typeof account !== 'object') throw malformed('account');

  const { balance = 0, trc20 = [] } = account as { balance?: unknown; trc20?: unknown };
  if (typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0) throw malformed('balance');
  if (!Array.isArray(trc20)) throw malformed('trc20');

  // trc20 is an array of {contractAddress: amountString} objects
  const entry = trc20.find(
    (t): t is Record<string, unknown> =>
      !!t && typeof t === 'object' &&
      Object.keys(t)[0]?.toLowerCase() === USDT_TRC20_CONTRACT.toLowerCase(),
  );
  let usdtTrc = 0;
  if (entry) {
    const raw = Object.values(entry)[0];
    const units = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw)
      : typeof raw === 'number' ? raw
      : NaN;
    if (!Number.isFinite(units) || units < 0) throw malformed('trc20 amount');
    usdtTrc = units / 1e6;
  }
  return { trx: balance / 1e6, usdtTrc };
}

/**
 * TRX + USDT TRC-20 одним запросом (раньше — два одинаковых вызова).
 * `headers` — для серверного вызова с TRON-PRO-API-KEY; в браузере не передаётся.
 * Бросает при сетевой ошибке, не-2xx, битом JSON и error-поле API: что
 * делать, решает вызывающий. Неактивированный аккаунт даёт честный 0.
 */
export async function fetchTronAccountBalances(
  address: string,
  headers: Record<string, string> = {},
): Promise<TronAccountBalances> {
  if (!address || !isValidTronAddress(address)) return { trx: 0, usdtTrc: 0 };
  const res = await fetch(`${TRONGRID}/v1/accounts/${address}`, {
    headers: { Accept: 'application/json', ...headers },
  });
  if (!res.ok) throw new Error(`TronGrid ${res.status}`);
  return parseTronAccount(await res.json());
}

/**
 * Keyless browser path: TRX and USDT TRC-20 come from the same /v1/accounts
 * response, and balances.ts asks for both at once. Share the in-flight request
 * so a refresh is one TronGrid call, not two (keyless TronGrid answers 429
 * quickly).
 */
const tronAccountInflight = new Map<string, Promise<TronAccountBalances>>();
function sharedTronAccount(address: string): Promise<TronAccountBalances> {
  const hit = tronAccountInflight.get(address);
  if (hit) return hit;
  const p = fetchTronAccountBalances(address).finally(() => tronAccountInflight.delete(address));
  tronAccountInflight.set(address, p);
  return p;
}

/** Throws on provider failure (no silent 0); a non-activated account is 0. */
export async function fetchUsdtTrc20Balance(address: string): Promise<number> {
  return (await sharedTronAccount(address)).usdtTrc;
}

/** Throws on provider failure (no silent 0); a non-activated account is 0. */
export async function fetchTrxBalance(address: string): Promise<number> {
  return (await sharedTronAccount(address)).trx;
}

// ─── Local verification of TronGrid-built transactions (no blind signing) ────
//
// Minimal protobuf reader for exactly what a TRON Transaction.raw needs.
// Field numbers follow java-tron protocol/src/main/protos:
//   core/Tron.proto                        Transaction.raw, Transaction.Contract
//   core/contract/balance_contract.proto   TransferContract
//   core/contract/smart_contract.proto     TriggerSmartContract
//   google/protobuf/any.proto              Any { type_url = 1; value = 2 }
// Strict on purpose: unknown fields, unexpected wire types and repeated
// singular fields are rejected, so the bytes we sign mean what we checked.

export type TronTxMismatchReason =
  | 'format'          // not hex / not decodable / malformed protobuf
  | 'txid'            // txID != sha256(raw_data_hex)
  | 'extra_field'     // memo/data, auths, scripts, provider, permission, unknown fields
  | 'contract_count'  // not exactly one contract
  | 'contract_type'   // wrong ContractType / type_url
  | 'owner'           // signer is not the sender
  | 'recipient'       // TRX to_address / USDT transfer recipient
  | 'amount'
  | 'token_contract'  // USDT: not the USDT TRC-20 contract
  | 'call_data'       // USDT: not transfer(address,uint256) (e.g. approve 095ea7b3)
  | 'call_value'      // USDT: TRX or TRC-10 attached to the call
  | 'fee_limit'
  | 'expiration';

const MISMATCH_RU: Record<TronTxMismatchReason, string> = {
  format: 'формат',
  txid: 'идентификатор',
  extra_field: 'лишние поля',
  contract_count: 'число операций',
  contract_type: 'тип операции',
  owner: 'отправитель',
  recipient: 'получатель',
  amount: 'сумма',
  token_contract: 'контракт токена',
  call_data: 'вызов контракта',
  call_value: 'вложенные монеты',
  fee_limit: 'лимит комиссии',
  expiration: 'срок действия',
};

/** Thrown before signing when the node-built transaction differs from the request. */
export class TronTxMismatchError extends Error {
  readonly reason: TronTxMismatchReason;
  constructor(reason: TronTxMismatchReason) {
    super(`Подпись отменена: транзакция от узла Tron не совпадает с запросом (${MISMATCH_RU[reason]}).`);
    this.name = 'TronTxMismatchError';
    this.reason = reason;
  }
}

function fail(reason: TronTxMismatchReason): never {
  throw new TronTxMismatchError(reason);
}

/** Strict hex → bytes: even length, [0-9a-f] only. */
function hexToBytesStrict(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) fail('format');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    const p = pos + i;
    if (p >= buf.length) fail('format');
    const byte = buf[p];
    if (i === 9 && byte > 1) fail('format'); // more than 64 bits
    value |= BigInt(byte & 0x7f) << BigInt(7 * i);
    if ((byte & 0x80) === 0) return [value, p + 1];
  }
  return fail('format');
}

type PbKind = 'varint' | 'bytes' | 'repeated_bytes';
type PbSchema = Record<number, PbKind>;
interface PbMessage {
  varints: Map<number, bigint>;
  bytes: Map<number, Uint8Array>;
  repeated: Map<number, Uint8Array[]>;
}

/** Wire types: 0 = varint, 2 = length-delimited. Nothing else occurs in these messages. */
function parsePb(buf: Uint8Array, schema: PbSchema): PbMessage {
  const msg: PbMessage = { varints: new Map(), bytes: new Map(), repeated: new Map() };
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = readVarint(buf, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    const kind = Object.prototype.hasOwnProperty.call(schema, field) ? schema[field] : undefined;
    if (field === 0 || kind === undefined) fail('extra_field');

    if (kind === 'varint') {
      if (wire !== 0 || msg.varints.has(field)) fail('format');
      const [v, next] = readVarint(buf, afterKey);
      msg.varints.set(field, v);
      pos = next;
      continue;
    }

    if (wire !== 2) fail('format');
    const [len, start] = readVarint(buf, afterKey);
    if (len > BigInt(buf.length - start)) fail('format');
    const end = start + Number(len);
    const chunk = buf.slice(start, end);
    if (kind === 'bytes') {
      if (msg.bytes.has(field)) fail('format');
      msg.bytes.set(field, chunk);
    } else {
      const list = msg.repeated.get(field) ?? [];
      list.push(chunk);
      msg.repeated.set(field, list);
    }
    pos = end;
  }
  return msg;
}

const RAW_SCHEMA: PbSchema = {
  1: 'bytes',           // ref_block_bytes
  3: 'varint',          // ref_block_num
  4: 'bytes',           // ref_block_hash
  8: 'varint',          // expiration (ms)
  9: 'repeated_bytes',  // auths (unused)
  10: 'bytes',          // data (memo)
  11: 'repeated_bytes', // contract
  12: 'bytes',          // scripts (unused)
  14: 'varint',         // timestamp (ms)
  18: 'varint',         // fee_limit (sun)
};
const CONTRACT_SCHEMA: PbSchema = {
  1: 'varint',          // type (ContractType enum)
  2: 'bytes',           // parameter (google.protobuf.Any)
  3: 'bytes',           // provider
  4: 'bytes',           // ContractName
  5: 'varint',          // Permission_id
};
const ANY_SCHEMA: PbSchema = { 1: 'bytes', 2: 'bytes' }; // type_url, value
const TRANSFER_SCHEMA: PbSchema = {
  1: 'bytes',           // owner_address
  2: 'bytes',           // to_address
  3: 'varint',          // amount (sun)
};
const TRIGGER_SCHEMA: PbSchema = {
  1: 'bytes',           // owner_address
  2: 'bytes',           // contract_address
  3: 'varint',          // call_value (sun)
  4: 'bytes',           // data (ABI call data)
  5: 'varint',          // call_token_value
  6: 'varint',          // token_id
};

export const TRON_CONTRACT_TYPE = { TransferContract: 1, TriggerSmartContract: 31 } as const;
const TYPE_URL_TRANSFER = 'type.googleapis.com/protocol.TransferContract';
const TYPE_URL_TRIGGER = 'type.googleapis.com/protocol.TriggerSmartContract';

const int64 = (v: bigint | undefined): bigint | undefined => (v === undefined ? undefined : BigInt.asIntN(64, v));
const hexOf = (b: Uint8Array | undefined): string | undefined => (b === undefined ? undefined : bytesToHex(b));

export interface DecodedTronContract {
  type: number;
  typeUrl: string;
  hasProvider: boolean;
  hasContractName: boolean;
  permissionId: number;
  /** TransferContract (type 1) / TriggerSmartContract (type 31) fields; bytes as lowercase hex. */
  ownerHex?: string;
  toHex?: string;
  amount?: bigint;
  contractHex?: string;
  callValue?: bigint;
  dataHex?: string;
  callTokenValue?: bigint;
  tokenId?: bigint;
}

export interface DecodedTronRaw {
  refBlockBytesHex?: string;
  refBlockNum?: bigint;
  refBlockHashHex?: string;
  expiration?: bigint;
  authsCount: number;
  dataHex?: string;
  contracts: DecodedTronContract[];
  scriptsHex?: string;
  timestamp?: bigint;
  feeLimit?: bigint;
}

function decodeContract(bytes: Uint8Array): DecodedTronContract {
  const c = parsePb(bytes, CONTRACT_SCHEMA);
  const anyBytes = c.bytes.get(2) ?? fail('format');
  const any = parsePb(anyBytes, ANY_SCHEMA);
  let typeUrl = '';
  try {
    typeUrl = new TextDecoder('utf-8', { fatal: true }).decode(any.bytes.get(1) ?? new Uint8Array());
  } catch {
    fail('format');
  }
  const out: DecodedTronContract = {
    type: Number(BigInt.asIntN(32, c.varints.get(1) ?? 0n)),
    typeUrl,
    hasProvider: c.bytes.has(3),
    hasContractName: c.bytes.has(4),
    permissionId: Number(BigInt.asIntN(32, c.varints.get(5) ?? 0n)),
  };
  const value = any.bytes.get(2) ?? new Uint8Array();
  if (out.type === TRON_CONTRACT_TYPE.TransferContract) {
    const p = parsePb(value, TRANSFER_SCHEMA);
    out.ownerHex = hexOf(p.bytes.get(1));
    out.toHex = hexOf(p.bytes.get(2));
    out.amount = int64(p.varints.get(3)) ?? 0n;
  } else if (out.type === TRON_CONTRACT_TYPE.TriggerSmartContract) {
    const p = parsePb(value, TRIGGER_SCHEMA);
    out.ownerHex = hexOf(p.bytes.get(1));
    out.contractHex = hexOf(p.bytes.get(2));
    out.callValue = int64(p.varints.get(3)) ?? 0n;
    out.dataHex = hexOf(p.bytes.get(4));
    out.callTokenValue = int64(p.varints.get(5)) ?? 0n;
    out.tokenId = int64(p.varints.get(6)) ?? 0n;
  }
  return out;
}

/** Decode Transaction.raw from raw_data_hex (strict; throws TronTxMismatchError). */
export function decodeTronRawData(rawDataHex: string): DecodedTronRaw {
  const raw = parsePb(hexToBytesStrict(rawDataHex), RAW_SCHEMA);
  return {
    refBlockBytesHex: hexOf(raw.bytes.get(1)),
    refBlockNum: int64(raw.varints.get(3)),
    refBlockHashHex: hexOf(raw.bytes.get(4)),
    expiration: int64(raw.varints.get(8)),
    authsCount: raw.repeated.get(9)?.length ?? 0,
    dataHex: hexOf(raw.bytes.get(10)),
    contracts: (raw.repeated.get(11) ?? []).map(decodeContract),
    scriptsHex: hexOf(raw.bytes.get(12)),
    timestamp: int64(raw.varints.get(14)),
    feeLimit: int64(raw.varints.get(18)),
  };
}

export interface TronTxExpectation {
  kind: 'trx' | 'usdt';
  /** Sender, 21-byte "41…" hex. */
  ownerHex: string;
  /** Recipient, 21-byte "41…" hex (USDT: the token receiver, not the contract). */
  toHex: string;
  /** Sun for TRX, token base units for USDT. */
  amount: bigint;
  /** fee_limit the code requested, sun (0n for TRX: TransferContract has none). */
  feeLimitSun: bigint;
}

export interface VerifiedTronTx {
  txID: string;        // lowercase, == sha256(rawBytes)
  rawDataHex: string;  // lowercase
  rawBytes: Uint8Array;
}

const MAX_RAW_BYTES = 2048;                         // a USDT transfer is ~211 bytes
/** TRON protocol maximum for expiration − build time. */
const MAX_EXPIRATION_AHEAD_MS = 24 * 60 * 60 * 1000;
/**
 * Sanity bounds against the DEVICE clock only. Phone clocks are often minutes
 * or hours off, and TronGrid sets expiration ≈ head block time + 60 s, so a
 * tight device-clock check (it was now − 2 min) failed every TRON send on a
 * phone running 3+ minutes fast. The real check is against the transaction's
 * own build timestamp; these only catch a node answer that is wildly off.
 */
const DEVICE_CLOCK_PAST_MS = 6 * 60 * 60 * 1000;
const DEVICE_CLOCK_FUTURE_MS = 25 * 60 * 60 * 1000;
const USDT_TRC20_CONTRACT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const ZERO_PAD_12 = '0'.repeat(24);

/**
 * Verify a TronGrid-built, unsigned transaction against what the wallet asked
 * for. Throws TronTxMismatchError on ANY difference; the caller must not sign
 * in that case. Returns the exact bytes to sign (sha256(rawBytes) == txID).
 */
export function verifyTronTransaction(
  tx: unknown,
  exp: TronTxExpectation,
  nowMs: number = Date.now(),
): VerifiedTronTx {
  const t = tx as { txID?: unknown; raw_data_hex?: unknown } | null;
  if (!t || typeof t !== 'object' || typeof t.raw_data_hex !== 'string' || typeof t.txID !== 'string') {
    return fail('format');
  }
  const rawDataHex = t.raw_data_hex.toLowerCase();
  if (rawDataHex.length === 0 || rawDataHex.length > MAX_RAW_BYTES * 2) fail('format');
  const rawBytes = hexToBytesStrict(rawDataHex);

  // 1. txID must be the hash of exactly these bytes.
  const txID = bytesToHex(sha256b(rawBytes));
  if (!/^[0-9a-fA-F]{64}$/.test(t.txID) || t.txID.toLowerCase() !== txID) fail('txid');

  // 2. Decode and check the envelope.
  const raw = decodeTronRawData(rawDataHex);
  if (raw.authsCount > 0 || raw.scriptsHex !== undefined || raw.dataHex !== undefined) fail('extra_field');
  if (raw.contracts.length !== 1) fail('contract_count');
  if (raw.refBlockBytesHex?.length !== 4 || raw.refBlockHashHex?.length !== 16) fail('format');

  // Expiration vs the tx's own build time (raw.timestamp, set by the node):
  // after it, and at most the protocol's 24 h later. The device clock only
  // gets a generous sanity bound (see DEVICE_CLOCK_*).
  const expiration = raw.expiration;
  const timestamp = raw.timestamp;
  if (expiration === undefined || timestamp === undefined || timestamp <= 0n) return fail('expiration');
  if (expiration <= timestamp || expiration - timestamp > BigInt(MAX_EXPIRATION_AHEAD_MS)) fail('expiration');
  if (expiration < BigInt(Math.floor(nowMs - DEVICE_CLOCK_PAST_MS))
      || expiration > BigInt(Math.floor(nowMs + DEVICE_CLOCK_FUTURE_MS))) {
    fail('expiration');
  }
  const feeLimit = raw.feeLimit ?? 0n;
  if (feeLimit < 0n || feeLimit > exp.feeLimitSun) fail('fee_limit');

  // 3. The single contract.
  const c = raw.contracts[0];
  if (c.hasProvider || c.hasContractName || c.permissionId !== 0) fail('extra_field');
  const ownerHex = exp.ownerHex.toLowerCase();
  const toHex = exp.toHex.toLowerCase();

  if (exp.kind === 'trx') {
    if (c.type !== TRON_CONTRACT_TYPE.TransferContract || c.typeUrl !== TYPE_URL_TRANSFER) fail('contract_type');
    if (c.ownerHex !== ownerHex) fail('owner');
    if (c.toHex !== toHex) fail('recipient');
    if (c.amount !== exp.amount) fail('amount');
  } else {
    if (c.type !== TRON_CONTRACT_TYPE.TriggerSmartContract || c.typeUrl !== TYPE_URL_TRIGGER) fail('contract_type');
    if (c.ownerHex !== ownerHex) fail('owner');
    if (c.contractHex !== USDT_TRC20_CONTRACT_HEX) fail('token_contract');
    if (c.callValue !== 0n || c.callTokenValue !== 0n || c.tokenId !== 0n) fail('call_value');
    // transfer(address,uint256) = a9059cbb ‖ 12 zero bytes ‖ 20-byte recipient ‖ uint256 amount
    const data = c.dataHex ?? '';
    if (data.length !== 8 + 64 + 64 || data.slice(0, 8) !== 'a9059cbb') fail('call_data');
    if (data.slice(8, 32) !== ZERO_PAD_12 || data.slice(32, 72) !== toHex.slice(2)) fail('recipient');
    if (BigInt('0x' + data.slice(72)) !== exp.amount) fail('amount');
  }

  return { txID, rawDataHex, rawBytes };
}

// ─── Signing + broadcast ──────────────────────────────────────────────────────

/** Tron signature = 64-byte compact + 1-byte recovery (v), over sha256(raw). */
function signVerified(verified: VerifiedTronTx, privKey: Uint8Array): string {
  const sig = secp256k1.sign(sha256b(verified.rawBytes), privKey, { lowS: true });
  return bytesToHex(sig.toCompactRawBytes()) + sig.recovery.toString(16).padStart(2, '0');
}

const BROADCAST_TIMEOUT_MS = 20_000;
const LOOKUP_TIMEOUT_MS = 10_000;

/** fetch with a hard timeout (rejects 'TRON_TIMEOUT'), also when the abort signal is ignored. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller?.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new Error('TRON_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type TronBroadcastAnswer =
  | { kind: 'accepted' }
  | { kind: 'rejected'; message: string }
  | { kind: 'no_answer' };

/**
 * java-tron answers HTTP 200 with {result: true} or {code, message}: both are
 * definitive, as is {Error} (thrown before the node broadcasts) and any 4xx
 * other than 429. DUP_TRANSACTION_ERROR means the node already holds this
 * txID: accepted. A network error, timeout, 5xx, 429, a non-JSON body or a
 * body that says neither is no answer: the tx may or may not be out.
 */
async function postTronBroadcast(body: string): Promise<TronBroadcastAnswer> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${TRONGRID}/wallet/broadcasttransaction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }, BROADCAST_TIMEOUT_MS);
  } catch {
    return { kind: 'no_answer' };
  }
  const status = typeof res.status === 'number' ? res.status : (res.ok ? 200 : 0);
  if (status === 429 || status >= 500 || status === 0) return { kind: 'no_answer' };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (obj?.result === true) return { kind: 'accepted' };
  if (obj?.code === 'DUP_TRANSACTION_ERROR') return { kind: 'accepted' };
  if (obj && (typeof obj.code === 'string' || obj.result === false)) {
    return { kind: 'rejected', message: tronBroadcastError(obj) };
  }
  if (obj && typeof obj.Error === 'string') return { kind: 'rejected', message: obj.Error.slice(0, 200) };
  if (!res.ok) return { kind: 'rejected', message: `Ошибка отправки в сеть Tron (HTTP ${status}).` };
  return { kind: 'no_answer' };
}

/** /wallet/gettransactionbyid: `{}` until the node has the tx, the tx (with txID) after. */
async function tronNodeHasTx(txID: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${TRONGRID}/wallet/gettransactionbyid`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ value: txID }),
    }, LOOKUP_TIMEOUT_MS);
    if (!res.ok) return false;
    const json = await res.json() as { txID?: unknown } | null;
    return !!json && typeof json === 'object' && typeof json.txID === 'string' && json.txID.toLowerCase() === txID;
  } catch {
    return false;
  }
}

/**
 * Broadcast the signed, verified tx. Returns the txID we signed (never the
 * node's echo). Throws an Error with the node text on a definitive rejection,
 * and BroadcastOutcomeUnknownError(txID) when TronGrid gave no answer and the
 * tx cannot be found by id (it may still be out: the UI polls, no re-send).
 */
async function broadcastVerified(
  tx: Record<string, unknown>,
  verified: VerifiedTronTx,
  sigHex: string,
): Promise<string> {
  const answer = await postTronBroadcast(
    JSON.stringify({ ...tx, txID: verified.txID, raw_data_hex: verified.rawDataHex, signature: [sigHex] }),
  );
  if (answer.kind === 'accepted') return verified.txID;
  if (answer.kind === 'rejected') throw new Error(answer.message);
  if (await tronNodeHasTx(verified.txID)) return verified.txID;
  throw new BroadcastOutcomeUnknownError(verified.txID, 'TRON broadcast outcome unknown: TronGrid did not answer.');
}

// ─── Send USDT TRC-20 ─────────────────────────────────────────────────────────

/**
 * Build (TronGrid), verify locally, sign and broadcast a USDT TRC-20 transfer.
 * @param privKey  32-byte secp256k1 private key (Tron BIP44 derived)
 * @param toAddr   Recipient Tron address (T…)
 * @param amount   USDT amount (human-readable, e.g. 10.5), ≤ 6 decimals
 * @returns        Transaction ID (txid)
 */
export async function sendUsdtTrc20Raw(
  privKey: Uint8Array,
  toAddr:  string,
  amount:  number,
): Promise<string> {
  if (!isValidTronAddress(toAddr)) throw new Error('Неверный TRON-адрес получателя.');
  const units = toTronBaseUnits(amount);

  const fromAddr    = tronAddressFromPrivKey(privKey);
  const fromHex     = tronAddrToHex(fromAddr);
  const toHex       = tronAddrToHex(toAddr);
  const contractHex = tronAddrToHex(USDT_TRC20_CONTRACT);
  const callData    = buildTransferData(toHex, units);

  // 1. Ask TronGrid to build the transaction
  const buildRes = await fetch(`${TRONGRID}/wallet/triggersmartcontract`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      owner_address:    fromHex,
      contract_address: contractHex,
      data:             callData,                  // full ABI call data (selector + params)
      fee_limit:        USDT_TRC20_FEE_LIMIT_SUN,  // max 30 TRX for energy
      call_value:       0,
      visible:          false,                     // hex addresses mode
    }),
  });

  if (!buildRes.ok) {
    throw new Error('TronGrid недоступен. Проверь соединение и попробуй позже.');
  }

  const buildJson = await buildRes.json();

  if (!buildJson.transaction || buildJson.result?.code === 'CONTRACT_EXE_ERROR') {
    const msg = buildJson.result?.message
      ? Buffer.from(buildJson.result.message, 'hex').toString('utf8')
      : 'Ошибка построения транзакции Tron.';
    throw new Error(msg);
  }

  // 2. Verify what TronGrid built BEFORE signing (throws → nothing is signed).
  const verified = verifyTronTransaction(buildJson.transaction, {
    kind: 'usdt',
    ownerHex: fromHex,
    toHex,
    amount: units,
    feeLimitSun: BigInt(USDT_TRC20_FEE_LIMIT_SUN),
  });

  // 3. Sign SHA256(raw_data_bytes) (Tron uses SHA256, not keccak256). 4. Broadcast.
  return broadcastVerified(buildJson.transaction, verified, signVerified(verified, privKey));
}

export async function sendTrxRaw(
  privKey: Uint8Array,
  toAddr:  string,
  amount:  number,
): Promise<string> {
  if (!isValidTronAddress(toAddr)) throw new Error('Неверный TRX-адрес получателя.');
  const amountSun = toTronBaseUnits(amount);

  const fromAddr = tronAddressFromPrivKey(privKey);
  const fromHex = tronAddrToHex(fromAddr);
  const toHex = tronAddrToHex(toAddr);

  const buildRes = await fetch(`${TRONGRID}/wallet/createtransaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      owner_address: fromHex,
      to_address:    toHex,
      amount:        Number(amountSun),
      visible:       false,
    }),
  });

  if (!buildRes.ok) {
    throw new Error('TronGrid недоступен. Проверь соединение и попробуй позже.');
  }

  const tx = await buildRes.json();
  if (!tx.raw_data_hex) {
    throw new Error(tx?.Error ?? 'Ошибка построения TRX-транзакции.');
  }

  const verified = verifyTronTransaction(tx, {
    kind: 'trx',
    ownerHex: fromHex,
    toHex,
    amount: amountSun,
    feeLimitSun: 0n,
  });

  return broadcastVerified(tx, verified, signVerified(verified, privKey));
}

/**
 * TronGrid broadcasttransaction отдаёт `message` в hex (как и build-шаг).
 * Декодируем, чтобы пользователь видел текст, а маппинг «insufficient» в UI срабатывал.
 */
export function tronBroadcastError(json: { message?: unknown; code?: unknown }): string {
  const raw = json.message ?? json.code;
  if (typeof raw !== 'string' || !raw) return 'Ошибка отправки в сеть Tron.';
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    const text = Buffer.from(raw, 'hex').toString('utf8');
    // eslint-disable-next-line no-control-regex
    if (text && !/[\u0000-\u0008]/.test(text)) return text;
  }
  return raw;
}

// ─── Fee estimate (energy + bandwidth + account activation) ──────────────────
//
// Replaces the static "~14 TRX" for USDT. TRX burned ≈
//   max(0, energy_used − sender's staked energy left) × getEnergyFee
// + bandwidth: 0 if staked (NetLimit−NetUsed) or free (freeNetLimit−freeNetUsed)
//   bandwidth covers the tx size, else size × getTransactionFee (all-or-nothing)
// + TRX to a non-activated account: getCreateNewAccountFeeInSystemContract
//   (1 TRX), and its bandwidth is staked-or-getCreateAccountFee (0.1 TRX);
//   free bandwidth cannot pay for account creation.
// fee_limit caps the TOTAL energy of the call (staked + burned) at
// fee_limit / getEnergyFee (java-tron VMActuator.getAccountEnergyLimitWithFixRatio),
// so energy_used × getEnergyFee > fee_limit means OUT_OF_ENERGY: TRX burned, USDT not moved.

/** Bandwidth bytes (java-tron: tx without ret + 65 B signature + 64 B result reserve). */
export const TRX_TRANSFER_BANDWIDTH_BYTES = 280;   // measured 267 B; headroom for long amounts
export const TRC20_TRANSFER_BANDWIDTH_BYTES = 345; // measured 345 B (fixed-size call data)

export interface TronFeeEstimate {
  /** 'live' = computed from chain data; 'static' = fallback, the live estimate was unavailable. */
  source: 'live' | 'static';
  /** Expected TRX burned by the send (energy + bandwidth + activation), TRX. */
  feeTrx: number;
  /** USDT only: energy the transfer needs (triggerconstantcontract, incl. dynamic-energy penalty). */
  energyUsed: number | null;
  /** USDT only: sender's staked energy left (EnergyLimit − EnergyUsed). */
  energyAvailable: number | null;
  /** USDT only: chain energy price, sun per energy (getEnergyFee). */
  energyFeeSun: number | null;
  /** USDT only: TRX burned for energy not covered by stake. */
  energyBurnTrx: number | null;
  /** USDT only: full energy value energy_used × price, compared with fee_limit. */
  energyCostTrx: number | null;
  /** USDT only: fee_limit the send uses, TRX. */
  feeLimitTrx: number | null;
  /** USDT only: energyCostTrx > feeLimitTrx → the send would fail with OUT_OF_ENERGY. */
  exceedsFeeLimit: boolean;
  bandwidthBytes: number;
  /** TRX burned for bandwidth (TRX to a new account: the 0.1 TRX creation bandwidth fee). */
  bandwidthBurnTrx: number | null;
  /** TRX only: whether the recipient account exists (null = not checked / unknown). */
  recipientActivated: boolean | null;
  /** TRX only: account-creation fee for a non-activated recipient (1 TRX), else 0. */
  activationFeeTrx: number;
  /** Why the live estimate was not used (source 'static'). */
  unavailableReason?: string;
}

export function tronStaticFeeEstimate(
  kind: 'trx' | 'usdt',
  feeTrx: number,
  unavailableReason: string,
): TronFeeEstimate {
  return {
    source: 'static',
    feeTrx,
    energyUsed: null,
    energyAvailable: null,
    energyFeeSun: null,
    energyBurnTrx: null,
    energyCostTrx: null,
    feeLimitTrx: kind === 'usdt' ? USDT_TRC20_FEE_LIMIT_SUN / 1e6 : null,
    exceedsFeeLimit: false,
    bandwidthBytes: kind === 'usdt' ? TRC20_TRANSFER_BANDWIDTH_BYTES : TRX_TRANSFER_BANDWIDTH_BYTES,
    bandwidthBurnTrx: null,
    recipientActivated: null,
    activationFeeTrx: 0,
    unavailableReason,
  };
}

type Json = Record<string, unknown>;

/** POST to TronGrid with a hard timeout; any transport/API error throws. */
async function tronPost(path: string, body: unknown, timeoutMs: number): Promise<Json> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (async () => {
    const res = await fetch(`${TRONGRID}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`TRON_ESTIMATE_HTTP_${res.status}`);
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('TRON_ESTIMATE_MALFORMED');
    const obj = json as Json;
    const result = obj.result as { code?: unknown } | undefined;
    if ('Error' in obj || 'error' in obj || (result && typeof result === 'object' && 'code' in result)) {
      throw new Error('TRON_ESTIMATE_API_ERROR');
    }
    return obj;
  })();
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new Error('TRON_ESTIMATE_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function chainParam(json: Json, key: string): number {
  const list = json.chainParameter;
  if (!Array.isArray(list)) throw new Error('TRON_ESTIMATE_BAD_PARAMS');
  const entry = list.find((e) => !!e && typeof e === 'object' && (e as Json).key === key) as Json | undefined;
  const v = entry?.value;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error(`TRON_ESTIMATE_BAD_PARAM_${key}`);
  return v;
}

interface TronAccountResource {
  freeNetLimit: number;
  freeNetUsed: number;
  NetLimit: number;
  NetUsed: number;
  EnergyLimit: number;
  EnergyUsed: number;
}

/** /wallet/getaccountresource omits zero fields (a fresh account is `{}`). */
function parseAccountResource(json: Json): TronAccountResource {
  const num = (key: keyof TronAccountResource): number => {
    const v = json[key];
    if (v === undefined) return 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('TRON_ESTIMATE_BAD_RESOURCE');
    return v;
  };
  return {
    freeNetLimit: num('freeNetLimit'),
    freeNetUsed: num('freeNetUsed'),
    NetLimit: num('NetLimit'),
    NetUsed: num('NetUsed'),
    EnergyLimit: num('EnergyLimit'),
    EnergyUsed: num('EnergyUsed'),
  };
}

/** /wallet/getaccount: `{}` = not activated; an object with `address` = exists. */
function parseActivated(json: Json): boolean {
  if (Object.keys(json).length === 0) return false;
  if (typeof json.address === 'string' && json.address.length > 0) return true;
  throw new Error('TRON_ESTIMATE_BAD_ACCOUNT');
}

/** TronGrid sends VM / API messages hex-encoded ("REVERT opcode executed" → 5245…); plain text passes through. */
function tronApiText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) return raw;
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return raw;
  }
}

/**
 * The contract itself refused the call: REVERT (require failed: USDT balance
 * below the amount, sender blacklisted, token paused) or an INVALID opcode
 * (assert). Deterministic: the real transfer would fail the same way on chain
 * and still burn TRX for the energy it used.
 */
const TRON_CONTRACT_REFUSED_RE = /REVERT opcode executed|\brevert\b|Invalid operation code/i;

/**
 * /wallet/triggerconstantcontract: energy_used of a successful dry run.
 * Throws 'TRON_ESTIMATE_REVERT' when the contract refused the transfer (the
 * review blocks the send), 'TRON_ESTIMATE_DRY_RUN_FAILED' for any other failed
 * dry run (CPU timeout, unclear answer: the static estimate is used, non-blocking).
 */
function parseEnergyUsed(json: Json): number {
  const result = json.result as { result?: unknown; message?: unknown } | undefined;
  const ret = (json.transaction as { ret?: Array<{ ret?: unknown }> } | undefined)?.ret?.[0]?.ret;
  const message = tronApiText(result?.message);
  const failed = !result || result.result !== true || message !== '' || (ret !== undefined && ret !== 'SUCCESS');
  if (failed) {
    throw new Error(TRON_CONTRACT_REFUSED_RE.test(message) ? 'TRON_ESTIMATE_REVERT' : 'TRON_ESTIMATE_DRY_RUN_FAILED');
  }
  const e = json.energy_used;
  if (typeof e !== 'number' || !Number.isSafeInteger(e) || e <= 0) throw new Error('TRON_ESTIMATE_BAD_ENERGY');
  return e;
}

/**
 * Sender's TRX balance in sun from /wallet/getaccount (read-only). `{}` = not
 * activated = 0. Throws on any provider failure or odd answer: the caller then
 * treats the balance as unknown.
 */
export async function fetchTronTrxBalanceSun(address: string, timeoutMs = 6_000): Promise<number> {
  if (!isValidTronAddress(address)) throw new Error('TRON_BALANCE_BAD_ADDRESS');
  const json = await tronPost('/wallet/getaccount', { address, visible: true }, timeoutMs);
  if (!parseActivated(json)) return 0;
  const balance = json.balance ?? 0; // omitted when 0
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) throw new Error('TRON_BALANCE_BAD');
  return balance;
}

function bandwidthBurnSun(bytes: number, r: TronAccountResource, txFeeSun: number): number {
  const staked = Math.max(0, r.NetLimit - r.NetUsed);
  const free = Math.max(0, r.freeNetLimit - r.freeNetUsed);
  return staked >= bytes || free >= bytes ? 0 : bytes * txFeeSun;
}

export interface TronFeeEstimateInput {
  kind: 'trx' | 'usdt';
  /** Sender "T…" address. */
  from: string;
  /** Recipient "T…" address. */
  to: string;
  /** Human amount (TRX or USDT). */
  amount: number;
  /** Per-request timeout, ms. */
  timeoutMs?: number;
}

/**
 * Live TRON fee estimate (read-only TronGrid calls, never builds or signs).
 * Throws if any call fails or returns something unexpected: the caller falls
 * back to the static estimate and flags it.
 */
export async function estimateTronFee(input: TronFeeEstimateInput): Promise<TronFeeEstimate> {
  const { kind, from, to } = input;
  if (!isValidTronAddress(from) || !isValidTronAddress(to)) throw new Error('TRON_ESTIMATE_BAD_ADDRESS');
  const units = toTronBaseUnits(input.amount);
  const timeoutMs = input.timeoutMs ?? 6_000;

  const [chain, resource, third] = await Promise.all([
    tronPost('/wallet/getchainparameters', {}, timeoutMs),
    tronPost('/wallet/getaccountresource', { address: from, visible: true }, timeoutMs),
    kind === 'usdt'
      ? tronPost('/wallet/triggerconstantcontract', {
          owner_address:    tronAddrToHex(from),
          contract_address: tronAddrToHex(USDT_TRC20_CONTRACT),
          data:             buildTransferData(tronAddrToHex(to), units),
          call_value:       0,
          visible:          false,
        }, timeoutMs)
      : tronPost('/wallet/getaccount', { address: to, visible: true }, timeoutMs),
  ]);

  const r = parseAccountResource(resource);
  const txFeeSun = chainParam(chain, 'getTransactionFee');

  if (kind === 'trx') {
    const bytes = TRX_TRANSFER_BANDWIDTH_BYTES;
    const activated = parseActivated(third);
    let bandwidthSun: number;
    let activationSun = 0;
    if (activated) {
      bandwidthSun = bandwidthBurnSun(bytes, r, txFeeSun);
    } else {
      activationSun = chainParam(chain, 'getCreateNewAccountFeeInSystemContract');
      const staked = Math.max(0, r.NetLimit - r.NetUsed);
      bandwidthSun = staked >= bytes ? 0 : chainParam(chain, 'getCreateAccountFee');
    }
    return {
      source: 'live',
      feeTrx: (bandwidthSun + activationSun) / 1e6,
      energyUsed: null,
      energyAvailable: null,
      energyFeeSun: null,
      energyBurnTrx: null,
      energyCostTrx: null,
      feeLimitTrx: null,
      exceedsFeeLimit: false,
      bandwidthBytes: bytes,
      bandwidthBurnTrx: bandwidthSun / 1e6,
      recipientActivated: activated,
      activationFeeTrx: activationSun / 1e6,
    };
  }

  const energyFeeSun = chainParam(chain, 'getEnergyFee');
  const energyUsed = parseEnergyUsed(third);
  const energyAvailable = Math.max(0, r.EnergyLimit - r.EnergyUsed);
  const energyBurnSun = Math.max(0, energyUsed - energyAvailable) * energyFeeSun;
  const energyCostSun = energyUsed * energyFeeSun;
  const bandwidthSun = bandwidthBurnSun(TRC20_TRANSFER_BANDWIDTH_BYTES, r, txFeeSun);
  return {
    source: 'live',
    feeTrx: (energyBurnSun + bandwidthSun) / 1e6,
    energyUsed,
    energyAvailable,
    energyFeeSun,
    energyBurnTrx: energyBurnSun / 1e6,
    energyCostTrx: energyCostSun / 1e6,
    feeLimitTrx: USDT_TRC20_FEE_LIMIT_SUN / 1e6,
    exceedsFeeLimit: energyCostSun > USDT_TRC20_FEE_LIMIT_SUN,
    bandwidthBytes: TRC20_TRANSFER_BANDWIDTH_BYTES,
    bandwidthBurnTrx: bandwidthSun / 1e6,
    recipientActivated: null,
    activationFeeTrx: 0,
  };
}

// ─── Transaction history ──────────────────────────────────────────────────────

export interface TronTxRow {
  txid:        string;
  type:        'in' | 'out';
  amount:      number;   // USDT
  counterpart: string;   // from or to address
  timestamp:   number;   // ms
}

export async function fetchUsdtTrc20Txs(address: string): Promise<TronTxRow[]> {
  if (!address || !isValidTronAddress(address)) return [];
  try {
    const url =
      `${TRONGRID}/v1/accounts/${address}/transactions/trc20` +
      `?contract_address=${USDT_TRC20_CONTRACT}&limit=20&order_by=block_timestamp,desc`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.data)) return [];

    return data.data.map((tx: Record<string, unknown>) => {
      const from  = tx.from as string;
      const to    = tx.to   as string;
      const isOut = from.toLowerCase() === address.toLowerCase();
      return {
        txid:        tx.transaction_id as string,
        type:        isOut ? 'out' : 'in',
        amount:      parseInt(tx.value as string, 10) / 1e6,
        counterpart: isOut ? to : from,
        timestamp:   tx.block_timestamp as number,
      };
    });
  } catch {
    return [];
  }
}
