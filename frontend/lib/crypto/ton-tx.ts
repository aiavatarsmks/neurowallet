/**
 * lib/crypto/ton-tx.ts
 * TON native + USDT Jetton (TRC-like on TON network).
 *
 * Key derivation: SLIP-0010 ed25519 at m/44'/607'/0'/0/0
 * Wallet:         WalletContractV4 (V4R2 in TON ecosystem)
 * USDT master:    EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs (6 decimals)
 * Transport:      TonCenter public API (free, 1 req/s)
 */

import {
  WalletContractV4,
  TonClient,
  Address,
  beginCell,
  toNano,
  internal,
  JettonMaster,
  JettonWallet,
} from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';

export const USDT_TON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TON_CENTER_RPC = 'https://toncenter.com/api/v2/jsonRPC';
const TON_CENTER_API = 'https://toncenter.com/api/v2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTonClient(): TonClient {
  return new TonClient({ endpoint: TON_CENTER_RPC });
}

// ─── Address derivation ───────────────────────────────────────────────────────

export function tonAddressFromPrivKey(privKeyBytes: Uint8Array): string {
  const keyPair = keyPairFromSeed(Buffer.from(privKeyBytes));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  return wallet.address.toString({ bounceable: true, urlSafe: true });
}

// ─── Address validation ───────────────────────────────────────────────────────

export function isValidTonAddress(addr: string): boolean {
  if (!addr) return false;
  try {
    Address.parse(addr);
    return true;
  } catch {
    return false;
  }
}

// ─── Balances ─────────────────────────────────────────────────────────────────

export async function fetchTonBalance(address: string): Promise<number> {
  if (!address || !isValidTonAddress(address)) return 0;
  try {
    const res = await fetch(`${TON_CENTER_API}/getAddressBalance?address=${encodeURIComponent(address)}`);
    if (!res.ok) return 0;
    const data = await res.json();
    if (data.error || data.result === undefined) return 0;
    return parseInt(data.result, 10) / 1e9;
  } catch {
    return 0;
  }
}

export async function fetchUsdtTonBalance(address: string): Promise<number> {
  if (!address || !isValidTonAddress(address)) return 0;
  try {
    const client = getTonClient();
    const usdtMaster = client.open(JettonMaster.create(Address.parse(USDT_TON_MASTER)));
    const jettonWalletAddr = await usdtMaster.getWalletAddress(Address.parse(address));
    const jettonWallet = client.open(JettonWallet.create(jettonWalletAddr));
    const balance = await jettonWallet.getBalance();
    return Number(balance) / 1e6; // 6 decimals
  } catch {
    return 0;
  }
}

// ─── Transaction history ──────────────────────────────────────────────────────

export interface TonTx {
  txid:        string;
  type:        'in' | 'out';
  amount:      number;
  counterpart: string;
  timestamp:   number; // ms
}

export async function fetchTonTxs(address: string): Promise<TonTx[]> {
  if (!address || !isValidTonAddress(address)) return [];
  try {
    const url = `${TON_CENTER_API}/getTransactions?address=${encodeURIComponent(address)}&limit=20`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error || !Array.isArray(data.result)) return [];

    return data.result
      .map((tx: Record<string, unknown>) => {
        const inMsg  = tx.in_msg  as Record<string, unknown> | undefined;
        const outMsgs = (tx.out_msgs as Array<Record<string, unknown>>) ?? [];

        const tonIn  = parseInt((inMsg?.value as string) || '0', 10);
        const tonOut = outMsgs.reduce(
          (s: number, m: Record<string, unknown>) => s + parseInt((m.value as string) || '0', 10),
          0,
        );

        const isOut = outMsgs.length > 0 && tonOut > 0;
        const amount = (isOut ? tonOut : tonIn) / 1e9;

        const counterpart = isOut
          ? ((outMsgs[0]?.destination as string) || '')
          : ((inMsg?.source as string) || '');

        const txId = (tx.transaction_id as Record<string, string>)?.hash ?? '';

        return { txid: txId, type: isOut ? 'out' : 'in', amount, counterpart, timestamp: (tx.utime as number) * 1000 };
      })
      .filter((tx: TonTx) => tx.amount > 0);
  } catch {
    return [];
  }
}

// ─── Send TON ─────────────────────────────────────────────────────────────────

export async function sendTonRaw(
  tonPrivBytes: Uint8Array,
  toAddress:    string,
  amountTon:    number,
): Promise<string> {
  const keyPair = keyPairFromSeed(Buffer.from(tonPrivBytes));
  const client  = getTonClient();
  const wallet  = client.open(
    WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }),
  );

  const seqno = await wallet.getSeqno();
  await wallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({ to: toAddress, value: toNano(amountTon.toString()), bounce: false }),
    ],
  });

  return `ton:seqno:${seqno}`;
}

// ─── Send USDT Jetton ─────────────────────────────────────────────────────────

export async function sendUsdtTonRaw(
  tonPrivBytes: Uint8Array,
  toAddress:    string,
  amountUsdt:   number,
): Promise<string> {
  const keyPair = keyPairFromSeed(Buffer.from(tonPrivBytes));
  const client  = getTonClient();
  const walletContract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  const wallet = client.open(walletContract);

  const usdtMaster = client.open(JettonMaster.create(Address.parse(USDT_TON_MASTER)));
  const jettonWalletAddr = await usdtMaster.getWalletAddress(walletContract.address);

  const seqno = await wallet.getSeqno();

  // Build Jetton transfer body (op 0x0f8a7ea5)
  const jettonTransferBody = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(BigInt(Date.now()), 64)
    .storeCoins(BigInt(Math.round(amountUsdt * 1e6)))
    .storeAddress(Address.parse(toAddress))
    .storeAddress(walletContract.address)
    .storeBit(false)
    .storeCoins(toNano('0.01'))
    .storeBit(false)
    .endCell();

  await wallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to:     jettonWalletAddr,
        value:  toNano('0.05'),
        bounce: true,
        body:   jettonTransferBody,
      }),
    ],
  });

  return `ton:seqno:${seqno}`;
}
