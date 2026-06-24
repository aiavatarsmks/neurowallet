/**
 * lib/crypto/btc-tx.ts
 * Bitcoin P2PKH transaction builder.
 * Supports sending from legacy (1xxx) addresses to P2PKH (1xxx) and P2SH (3xxx) recipients.
 * SegWit (bc1q/bc1p) outputs: recognised and rejected with a clear message.
 *
 * All crypto uses @noble/curves/secp256k1 + ethers for hashing.
 * No external bitcoin libraries required.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { ethers } from 'ethers';
import bs58 from 'bs58';

const BLOCKSTREAM = 'https://blockstream.info/api';
const MEMPOOL     = 'https://mempool.space/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UTXO {
  txid:   string;
  vout:   number;
  value:  number; // satoshis
  status: { confirmed: boolean; block_height?: number };
}

export interface BtcFeeEstimate {
  feeRateSat: number;   // sat/vByte
  feeSat:     number;   // total fee in satoshis for this tx
  feeBtc:     number;   // fee in BTC
}

// ─── Hashing helpers ──────────────────────────────────────────────────────────

function sha256bytes(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.sha256(data));
}

function dsha256(data: Uint8Array): Uint8Array {
  return sha256bytes(sha256bytes(data));
}

function hash160(data: Uint8Array): Uint8Array {
  const s = sha256bytes(data);
  return ethers.getBytes(ethers.ripemd160(s));
}

// ─── Binary helpers ───────────────────────────────────────────────────────────

function u32LE(n: number): Uint8Array {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n, true);
  return a;
}

function u64LE(n: bigint): Uint8Array {
  const a = new Uint8Array(8);
  const v = new DataView(a.buffer);
  v.setUint32(0, Number(n & 0xFFFFFFFFn), true);
  v.setUint32(4, Number(n >> 32n), true);
  return a;
}

function varInt(n: number): Uint8Array {
  if (n < 0xFD) return new Uint8Array([n]);
  if (n <= 0xFFFF) {
    const a = new Uint8Array(3); a[0] = 0xFD;
    new DataView(a.buffer).setUint16(1, n, true);
    return a;
  }
  const a = new Uint8Array(5); a[0] = 0xFE;
  new DataView(a.buffer).setUint32(1, n, true);
  return a;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ─── Base58Check ──────────────────────────────────────────────────────────────

/**
 * Decode a Base58Check address, verify checksum, return { version, payload }.
 * Throws on invalid checksum or format.
 */
export function base58checkDecode(address: string): { version: number; payload: Uint8Array } {
  const decoded = bs58.decode(address);       // raw bytes (25 for P2PKH/P2SH)
  const body    = decoded.slice(0, -4);
  const check   = decoded.slice(-4);
  const hash    = dsha256(body);
  for (let i = 0; i < 4; i++) {
    if (hash[i] !== check[i]) throw new Error('Неверный BTC-адрес (контрольная сумма не совпадает).');
  }
  return { version: body[0], payload: body.slice(1) };
}

// ─── Address → scriptPubKey ───────────────────────────────────────────────────

export function addressToScriptPubKey(address: string): Uint8Array {
  if (address.startsWith('bc1') || address.startsWith('BC1')) {
    throw new Error(
      'Отправка на SegWit-адреса (bc1...) пока не поддерживается. ' +
      'Попробуй отправить на Legacy-адрес (1...) или P2SH-адрес (3...).'
    );
  }

  const { version, payload } = base58checkDecode(address);

  if (version === 0x00) {
    // P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
    return concat(new Uint8Array([0x76, 0xa9, 0x14]), payload, new Uint8Array([0x88, 0xac]));
  }
  if (version === 0x05) {
    // P2SH: OP_HASH160 <20 bytes> OP_EQUAL
    return concat(new Uint8Array([0xa9, 0x14]), payload, new Uint8Array([0x87]));
  }

  throw new Error(`Неизвестный тип BTC-адреса (версия ${version}).`);
}

// ─── Address validation ───────────────────────────────────────────────────────

export function isValidBtcAddress(address: string): boolean {
  if (!address) return false;
  if (address.startsWith('bc1') || address.startsWith('BC1')) return false; // SegWit — unsupported send
  try {
    const { version } = base58checkDecode(address);
    return version === 0x00 || version === 0x05;
  } catch {
    return false;
  }
}

// ─── Blockchain queries ───────────────────────────────────────────────────────

export async function fetchUTXOs(address: string): Promise<UTXO[]> {
  const res  = await fetch(`${BLOCKSTREAM}/address/${address}/utxo`);
  if (!res.ok) throw new Error('Не удалось получить UTXO (Blockstream недоступен).');
  const data = await res.json() as UTXO[];
  return data.filter((u) => u.status.confirmed);
}

export async function getBtcFeeRate(): Promise<number> {
  try {
    const res  = await fetch(`${MEMPOOL}/v1/fees/recommended`);
    const data = await res.json() as { hourFee: number };
    return Math.max(data.hourFee ?? 10, 2); // at least 2 sat/vByte
  } catch {
    return 15; // fallback
  }
}

export async function broadcastBtcTx(rawHex: string): Promise<string> {
  const res = await fetch(`${BLOCKSTREAM}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: rawHex,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Blockstream broadcast error: ' + text.slice(0, 200));
  }
  return await res.text(); // txid
}

// ─── UTXO selection ───────────────────────────────────────────────────────────

function estimateTxBytes(numInputs: number, numOutputs: number): number {
  // P2PKH input: 148 bytes; P2PKH/P2SH output: 34 bytes; overhead: 10
  return 10 + numInputs * 148 + numOutputs * 34;
}

interface SelectedUTXOs {
  utxos:   UTXO[];
  totalIn: bigint;
  fee:     bigint;
  change:  bigint;
}

export function selectUTXOs(
  available: UTXO[],
  amountSat: bigint,
  feeRateSat: number,
): SelectedUTXOs {
  // Sort descending by value for greedy selection
  const sorted = [...available].sort((a, b) => b.value - a.value);
  const selected: UTXO[] = [];
  let totalIn = 0n;

  for (const utxo of sorted) {
    selected.push(utxo);
    totalIn += BigInt(utxo.value);

    const numOutputs = 2; // recipient + change
    const feeSat = BigInt(Math.ceil(estimateTxBytes(selected.length, numOutputs) * feeRateSat));

    if (totalIn >= amountSat + feeSat) {
      const change = totalIn - amountSat - feeSat;
      return { utxos: selected, totalIn, fee: feeSat, change };
    }
  }

  const feeSat = BigInt(Math.ceil(estimateTxBytes(selected.length, 2) * feeRateSat));
  throw new Error(
    `Недостаточно средств. Доступно: ${Number(totalIn) / 1e8} BTC, нужно: ${Number(amountSat + feeSat) / 1e8} BTC (включая комиссию).`
  );
}

// ─── P2PKH Transaction signing ────────────────────────────────────────────────

/**
 * Build the serialized message for signing input at index `inputIdx`.
 * Uses SIGHASH_ALL: all inputs and outputs are included.
 */
function buildSighash(
  utxos:        UTXO[],
  fromScript:   Uint8Array,
  toScript:     Uint8Array,
  changeScript: Uint8Array,
  amountSat:    bigint,
  changeSat:    bigint,
  inputIdx:     number,
): Uint8Array {
  const VERSION  = u32LE(1);
  const SEQUENCE = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
  const LOCKTIME = u32LE(0);
  const SIGHASH  = u32LE(1); // SIGHASH_ALL

  // Inputs: only inputIdx gets fromScript; others get empty script
  const inputParts: Uint8Array[] = [];
  for (let i = 0; i < utxos.length; i++) {
    const txidBytes = hexToBytes(utxos[i].txid).reverse(); // little-endian
    const vout      = u32LE(utxos[i].vout);
    const script    = i === inputIdx ? fromScript : new Uint8Array(0);
    inputParts.push(concat(txidBytes, vout, varInt(script.length), script, SEQUENCE));
  }

  // Outputs: recipient + change
  const out1 = concat(u64LE(amountSat), varInt(toScript.length),     toScript);
  const out2 = concat(u64LE(changeSat), varInt(changeScript.length), changeScript);

  const raw = concat(
    VERSION,
    varInt(utxos.length), ...inputParts,
    varInt(2), out1, out2,
    LOCKTIME, SIGHASH,
  );

  return dsha256(raw);
}

// ─── Build signed raw transaction ─────────────────────────────────────────────

export function buildSignedTx(
  privKey:      Uint8Array,   // 32 bytes BTC private key
  utxos:        UTXO[],
  toAddress:    string,
  changeAddress: string,
  amountSat:    bigint,
  changeSat:    bigint,
): string {
  const compressedPub = secp256k1.getPublicKey(privKey, true); // 33 bytes
  const pubKeyHash    = hash160(compressedPub);

  // P2PKH scriptPubKey for our (FROM) address
  const fromScript = concat(
    new Uint8Array([0x76, 0xa9, 0x14]),
    pubKeyHash,
    new Uint8Array([0x88, 0xac]),
  );

  const toScript     = addressToScriptPubKey(toAddress);
  const changeScript = addressToScriptPubKey(changeAddress);

  const VERSION  = u32LE(1);
  const SEQUENCE = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
  const LOCKTIME = u32LE(0);

  // Sign each input
  const signedInputs: Uint8Array[] = [];
  for (let i = 0; i < utxos.length; i++) {
    const sighash   = buildSighash(utxos, fromScript, toScript, changeScript, amountSat, changeSat, i);
    const sig       = secp256k1.sign(sighash, privKey, { lowS: true });
    const derBytes  = sig.toDERRawBytes();
    const scriptSig = concat(
      varInt(derBytes.length + 1),
      derBytes,
      new Uint8Array([0x01]),      // SIGHASH_ALL
      varInt(compressedPub.length),
      compressedPub,
    );

    const txidBytes = hexToBytes(utxos[i].txid).reverse();
    signedInputs.push(concat(txidBytes, u32LE(utxos[i].vout), varInt(scriptSig.length), scriptSig, SEQUENCE));
  }

  const out1 = concat(u64LE(amountSat), varInt(toScript.length),     toScript);
  const out2 = concat(u64LE(changeSat), varInt(changeScript.length), changeScript);

  const rawTx = concat(
    VERSION,
    varInt(utxos.length), ...signedInputs,
    varInt(2), out1, out2,
    LOCKTIME,
  );

  return bytesToHex(rawTx);
}
