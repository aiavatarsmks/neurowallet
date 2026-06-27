/**
 * lib/crypto/tron-tx.ts
 * USDT TRC-20 on Tron via TronGrid public API.
 *
 * Key derivation: BIP44 m/44'/195'/0'/0/0  (secp256k1, same curve as ETH/BTC)
 * Address format: base58check(0x41 || keccak256(uncompressedPub[1:])[12:])
 * Signing:        SHA256(raw_data_hex_bytes)  (NOT keccak256 like ETH)
 * Transport:      TronGrid REST API (no key required for public endpoints)
 *
 * USDT contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (6 decimals)
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { ethers } from 'ethers';
import bs58 from 'bs58';

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID = 'https://api.trongrid.io';

// ─── Hashing helpers ──────────────────────────────────────────────────────────

function sha256b(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.sha256(data));
}

function keccak256b(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.keccak256(data));
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
  payload[0]            = 0x41;                                    // mainnet prefix
  payload.set(pubHash.slice(12), 1);                               // last 20 bytes
  return base58checkEncode(payload);
}

// ─── Address validation ───────────────────────────────────────────────────────

export function isValidTronAddress(addr: string): boolean {
  if (!addr || !addr.startsWith('T') || addr.length !== 34) return false;
  try {
    const decoded = bs58.decode(addr);
    if (decoded.length !== 25) return false;
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

function tronAddrToHex(addr: string): string {
  return Array.from(bs58.decode(addr).slice(0, 21))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── ABI-encode transfer(address,uint256) for USDT TRC-20 ────────────────────

function buildTransferData(toAddr: string, amountUsdt: number): string {
  // Function selector: keccak256("transfer(address,uint256)") → a9059cbb
  const selector = 'a9059cbb';

  // Tron address in ABI = strip 0x41 prefix byte → 20 bytes, right-padded to 32
  const addrBytes = bs58.decode(toAddr).slice(1, 21); // 20 bytes (no 0x41)
  const paddedAddr =
    '000000000000000000000000' + // 12 zero bytes
    Array.from(addrBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  // Amount: USDT TRC-20 has 6 decimals
  const amountRaw = BigInt(Math.round(amountUsdt * 1e6));
  const paddedAmt = amountRaw.toString(16).padStart(64, '0');

  return selector + paddedAddr + paddedAmt;
}

// ─── Balance ──────────────────────────────────────────────────────────────────

export async function fetchUsdtTrc20Balance(address: string): Promise<number> {
  if (!address || !isValidTronAddress(address)) return 0;
  try {
    const res = await fetch(`${TRONGRID}/v1/accounts/${address}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const account = (data.data ?? [])[0];
    if (!account) return 0;

    // trc20 is an array of {contractAddress: amountString} objects
    const trc20List: Array<Record<string, string>> = account.trc20 ?? [];
    const entry = trc20List.find(
      (t) => Object.keys(t)[0]?.toLowerCase() === USDT_TRC20_CONTRACT.toLowerCase(),
    );
    if (!entry) return 0;
    return parseInt(Object.values(entry)[0], 10) / 1e6;
  } catch {
    return 0;
  }
}

export async function fetchTrxBalance(address: string): Promise<number> {
  if (!address || !isValidTronAddress(address)) return 0;
  try {
    const res = await fetch(`${TRONGRID}/v1/accounts/${address}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const account = (data.data ?? [])[0];
    return ((account?.balance as number) ?? 0) / 1e6;
  } catch {
    return 0;
  }
}

// ─── Send USDT TRC-20 ─────────────────────────────────────────────────────────

/**
 * Build, sign and broadcast a USDT TRC-20 transfer.
 * @param privKey  32-byte secp256k1 private key (Tron BIP44 derived)
 * @param toAddr   Recipient Tron address (T…)
 * @param amount   USDT amount (human-readable, e.g. 10.5)
 * @returns        Transaction ID (txid)
 */
export async function sendUsdtTrc20Raw(
  privKey: Uint8Array,
  toAddr:  string,
  amount:  number,
): Promise<string> {
  const fromAddr    = tronAddressFromPrivKey(privKey);
  const fromHex     = tronAddrToHex(fromAddr);
  const contractHex = tronAddrToHex(USDT_TRC20_CONTRACT);
  const callData    = buildTransferData(toAddr, amount);

  // 1. Ask TronGrid to build the transaction
  const buildRes = await fetch(`${TRONGRID}/wallet/triggersmartcontract`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      owner_address:    fromHex,
      contract_address: contractHex,
      data:             callData,        // full ABI call data (selector + params)
      fee_limit:        30_000_000,      // max 30 TRX for energy/bandwidth
      call_value:       0,
      visible:          false,           // hex addresses mode
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

  const rawDataHex: string = buildJson.transaction.raw_data_hex;

  // 2. Sign: SHA256(raw_data_bytes)  — Tron uses SHA256, not keccak256
  const rawBytes = new Uint8Array(
    rawDataHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const msgHash = sha256b(rawBytes);
  const sig     = secp256k1.sign(msgHash, privKey, { lowS: true });

  // Tron signature = 64-byte compact + 1-byte recovery (v)
  const sigHex =
    Array.from(sig.toCompactRawBytes())
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('') +
    sig.recovery.toString(16).padStart(2, '0');

  // 3. Broadcast
  const broadcastRes = await fetch(`${TRONGRID}/wallet/broadcasttransaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...buildJson.transaction, signature: [sigHex] }),
  });

  const broadcastJson = await broadcastRes.json();

  if (!broadcastJson.result) {
    const msg = broadcastJson.message ?? broadcastJson.code ?? 'Ошибка отправки в сеть Tron.';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return broadcastJson.txid as string;
}

export async function sendTrxRaw(
  privKey: Uint8Array,
  toAddr:  string,
  amount:  number,
): Promise<string> {
  if (!isValidTronAddress(toAddr)) throw new Error('Неверный TRX-адрес получателя.');

  const fromAddr = tronAddressFromPrivKey(privKey);
  const amountSun = Math.round(amount * 1e6);
  if (amountSun <= 0) throw new Error('Сумма должна быть больше нуля.');

  const buildRes = await fetch(`${TRONGRID}/wallet/createtransaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      owner_address: tronAddrToHex(fromAddr),
      to_address:    tronAddrToHex(toAddr),
      amount:        amountSun,
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

  const rawBytes = new Uint8Array(
    (tx.raw_data_hex as string).match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const msgHash = sha256b(rawBytes);
  const sig = secp256k1.sign(msgHash, privKey, { lowS: true });
  const sigHex =
    Array.from(sig.toCompactRawBytes())
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('') +
    sig.recovery.toString(16).padStart(2, '0');

  const broadcastRes = await fetch(`${TRONGRID}/wallet/broadcasttransaction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...tx, signature: [sigHex] }),
  });

  const broadcastJson = await broadcastRes.json();
  if (!broadcastJson.result) {
    const msg = broadcastJson.message ?? broadcastJson.code ?? 'Ошибка отправки в сеть Tron.';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  return broadcastJson.txid as string;
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
