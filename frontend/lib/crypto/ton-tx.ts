/**
 * lib/crypto/ton-tx.ts
 * TON native + USDT Jetton (TRC-like on TON network).
 *
 * Key derivation: see wallet.ts — TON standard mnemonic (24-word, Tonkeeper-
 *                 compatible; ton-mnemonic.ts) or legacy SLIP-0010 ed25519
 *                 m/44'/607'/0'/0' (all segments hardened) for 12-word phrases
 * Wallet:         WalletContractV4 (V4R2 in TON ecosystem)
 * USDT master:    EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs (6 decimals)
 * Transport:      toncenter API v2. Balances go through /api/balances with a
 *                 server-side TONCENTER_API_KEY when configured (keyless public
 *                 limit is 1 req/s); direct keyless calls are the fallback.
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
import { amountToDecimalString } from '@/lib/display-format';
import { BroadcastOutcomeUnknownError } from './broadcast-error';

export const USDT_TON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TON_CENTER_RPC = 'https://toncenter.com/api/v2/jsonRPC';
const TON_CENTER_API = 'https://toncenter.com/api/v2';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** `apiKey` передаётся только из серверного кода (TONCENTER_API_KEY); в браузере — без ключа. */
function getTonClient(apiKey?: string): TonClient {
  return new TonClient({ endpoint: TON_CENTER_RPC, apiKey });
}

// ─── Address derivation ───────────────────────────────────────────────────────

/**
 * V4R2 address for a 32-byte ed25519 seed. `bounceable: false` gives the UQ…
 * form recommended for wallets (same account, different encoding).
 */
export function tonAddressFromPrivKey(
  privKeyBytes: Uint8Array,
  opts: { bounceable?: boolean } = {},
): string {
  const keyPair = keyPairFromSeed(Buffer.from(privKeyBytes));
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  return wallet.address.toString({ bounceable: opts.bounceable ?? true, urlSafe: true });
}

/** Any TON address form → non-bounceable UQ… for display; unparsable input returned as-is. */
export function toNonBounceableTon(address: string): string {
  try {
    return Address.parse(address).toString({ bounceable: false, urlSafe: true });
  } catch {
    return address;
  }
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

/**
 * Native TON balance. Бросает при сетевой ошибке, не-2xx (в т.ч. 429) и
 * кривом ответе: сбой провайдера никогда не превращается в 0. `apiKey`
 * передаётся только server-side.
 */
export async function fetchTonBalanceStrict(address: string, apiKey?: string): Promise<number> {
  if (!address || !isValidTonAddress(address)) return 0;
  const res = await fetch(
    `${TON_CENTER_API}/getAddressBalance?address=${encodeURIComponent(address)}`,
    { headers: apiKey ? { 'X-API-Key': apiKey } : {} },
  );
  if (!res.ok) throw new Error(`toncenter ${res.status}`);
  const data = await res.json();
  if (data?.error || data?.ok === false || data?.result === undefined) throw new Error('toncenter: bad response');
  const nano = Number(data.result);
  if (!Number.isFinite(nano)) throw new Error('toncenter: bad response');
  return nano / 1e9;
}

/** USDT (jetton) on TON. Бросает при ошибке. `apiKey` — только server-side. */
export async function fetchUsdtTonBalanceStrict(address: string, apiKey?: string): Promise<number> {
  if (!address || !isValidTonAddress(address)) return 0;
  const client = getTonClient(apiKey);
  const usdtMaster = client.open(JettonMaster.create(Address.parse(USDT_TON_MASTER)));
  const jettonWalletAddr = await usdtMaster.getWalletAddress(Address.parse(address));
  const jettonWallet = client.open(JettonWallet.create(jettonWalletAddr));
  try {
    const balance = await jettonWallet.getBalance();
    return Number(balance) / 1e6; // 6 decimals
  } catch (e) {
    // Jetton-кошелёк ещё не развёрнут (USDT никогда не приходил) → баланс 0, не ошибка.
    const deployed = await client.isContractDeployed(jettonWalletAddr).catch(() => true);
    if (!deployed) return 0;
    throw e;
  }
}

/**
 * Client-side (keyless) TON balance. Rejects on any provider failure, incl.
 * toncenter 429: balances.ts then marks TON unavailable instead of showing 0.
 */
export async function fetchTonBalance(address: string): Promise<number> {
  return fetchTonBalanceStrict(address);
}

const TONAPI = 'https://tonapi.io/v2';

/**
 * USDT-TON balance from tonapi in ONE request (keyless). The toncenter path
 * needs 2-3 jsonRPC calls, and keyless toncenter allows 1 rps, so together
 * with the TON balance it hit 429 on almost every page load. tonapi has its
 * own budget. 404 "has no jetton wallet" = USDT never received = real 0.
 */
export async function fetchUsdtTonBalanceTonapi(address: string): Promise<number> {
  if (!address || !isValidTonAddress(address)) return 0;
  const raw = Address.parse(address).toRawString();
  const res = await fetch(`${TONAPI}/accounts/${encodeURIComponent(raw)}/jettons/${USDT_TON_MASTER}`);
  if (res.status === 404) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error.includes('has no jetton wallet')) return 0;
    throw new Error('tonapi 404');
  }
  if (!res.ok) throw new Error(`tonapi ${res.status}`);
  const data = await res.json() as { balance?: unknown; jetton?: { decimals?: unknown } };
  const decimals = typeof data?.jetton?.decimals === 'number' ? data.jetton.decimals : 6;
  if (typeof data?.balance !== 'string' || !/^\d+$/.test(data.balance) || decimals !== 6) {
    throw new Error('tonapi: bad response');
  }
  return Number(BigInt(data.balance)) / 1e6;
}

/**
 * Client-side (keyless) USDT-TON balance: tonapi first (one call), toncenter
 * as the fallback. Rejects when both fail; an undeployed jetton wallet (USDT
 * never received) is a real 0.
 */
export async function fetchUsdtTonBalance(address: string): Promise<number> {
  try {
    return await fetchUsdtTonBalanceTonapi(address);
  } catch {
    return fetchUsdtTonBalanceStrict(address);
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

// ─── Send: outcome of the external message ───────────────────────────────────
//
// The send returns 'ton:seqno:N' (N = the wallet seqno the message was signed
// for); tx-status.ts polls the wallet seqno for it. If toncenter's answer to
// sendBoc is lost (network, timeout, 5xx, 429, non-JSON) the message may still
// be on its way, and a retry would sign seqno N+1 later: a second payment.
// So: seqno already past N → sent; otherwise BroadcastOutcomeUnknownError.

/** TonClient that records whether the signed external message was handed to toncenter. */
class SendTrackingTonClient extends TonClient {
  sendAttempted = false;
  override async sendFile(src: Buffer): Promise<void> {
    this.sendAttempted = true;
    return super.sendFile(src);
  }
  override async sendMessage(src: Parameters<TonClient['sendMessage']>[0]): Promise<void> {
    this.sendAttempted = true;
    return super.sendMessage(src);
  }
}

/** toncenter/liteserver refused the message itself (bad signature, seqno, not enough balance, bad BOC). */
const TON_REJECTED_RE = /cannot apply external message|external message was not accepted|inbound external message rejected|failed to (?:unpack|deserialize|parse)|invalid boc|bad boc/i;

/**
 * How @ton/ton (HttpApi → axios) surfaced a sendBoc failure:
 *  - AxiosError with `response` = HTTP error: 429 / 5xx are no answer, unless
 *    the body is toncenter's "cannot apply external message" (HTTP 500, a
 *    definitive rejection); any other 4xx is a refused request (not sent);
 *  - AxiosError without `response` (ERR_NETWORK, ECONNABORTED/ETIMEDOUT
 *    timeout) = no answer;
 *  - Error('Received error: …') = HTTP 200 without ok:true (e.g. a non-JSON
 *    page) = no answer unless it carries the rejection text;
 *  - Error('Malformed response: …') = ok:true with an odd body = no answer.
 */
function isDefinitiveTonSendError(err: unknown): boolean {
  const e = err as { response?: { status?: unknown; data?: unknown }; message?: unknown } | null;
  const data = e?.response?.data;
  const text = `${typeof e?.message === 'string' ? e.message : ''} ${typeof data === 'string' ? data : JSON.stringify(data ?? '')}`;
  if (TON_REJECTED_RE.test(text)) return true;
  const status = e?.response?.status;
  if (typeof status !== 'number') return false;
  return status !== 429 && status < 500;
}

const TON_SEQNO_CHECK_DELAY_MS = 1_100; // keyless toncenter: 1 request per second
const TON_SEQNO_CHECK_TIMEOUT_MS = 10_000;

/** Wallet seqno via toncenter runGetMethod; null if it could not be read. Uninitialized wallet → 0. */
async function readTonSeqno(walletAddress: string): Promise<number | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), TON_SEQNO_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${TON_CENTER_API}/runGetMethod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: walletAddress, method: 'seqno', stack: [] }),
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as { ok?: unknown; result?: { exit_code?: unknown; stack?: unknown } } | null;
    if (!json || json.ok !== true || !json.result || typeof json.result !== 'object') return null;
    const { exit_code: exitCode, stack } = json.result;
    // The get-method fails on an uninitialized wallet (the first send deploys it).
    if (exitCode !== 0 || !Array.isArray(stack)) return 0;
    const top: unknown = stack[0];
    const raw = Array.isArray(top) && top[0] === 'num' ? top[1] : null;
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(raw)) return null;
    return parseInt(raw, 16);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Has the wallet processed the message signed for `sentSeqno`? Two reads, 1.1 s apart. */
async function tonSeqnoAdvanced(walletAddress: string, sentSeqno: number): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, TON_SEQNO_CHECK_DELAY_MS));
    const current = await readTonSeqno(walletAddress);
    if (current !== null) return current > sentSeqno;
  }
  return false;
}

/**
 * sendTransfer failed. Returns normally if the message is known to be
 * processed; otherwise throws the original error (not sent, or definitively
 * refused) or BroadcastOutcomeUnknownError(hash).
 */
async function settleTonSendFailure(
  err: unknown,
  handedOver: boolean,
  walletAddress: string,
  seqno: number,
  hash: string,
): Promise<void> {
  // Failed before the message left (e.g. the deploy-state read): nothing was sent.
  if (!handedOver || isDefinitiveTonSendError(err)) throw err;
  if (await tonSeqnoAdvanced(walletAddress, seqno)) return;
  throw new BroadcastOutcomeUnknownError(hash, 'TON broadcast outcome unknown: toncenter did not answer.');
}

// ─── Send TON ─────────────────────────────────────────────────────────────────

// Memory hygiene (same rule as the SOL/BTC senders): the Buffer copy of the
// seed and keyPair.secretKey are zeroed in `finally`, on success and on every
// error path (and already right after sendTransfer, before any status
// lookup). The caller (transactions.ts) zeroes tonPrivBytes itself. Copies
// made inside @ton/crypto / tweetnacl are out of reach (JS limitation).

export async function sendTonRaw(
  tonPrivBytes: Uint8Array,
  toAddress:    string,
  amountTon:    number,
): Promise<string> {
  const seed = Buffer.from(tonPrivBytes);
  let secretKey: Buffer | null = null;
  try {
    const keyPair = keyPairFromSeed(seed);
    secretKey = keyPair.secretKey;
    const client  = new SendTrackingTonClient({ endpoint: TON_CENTER_RPC });
    const wallet  = client.open(
      WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 }),
    );

    const seqno = await wallet.getSeqno();
    const hash = `ton:seqno:${seqno}`;
    let sendError: unknown = null;
    try {
      await wallet.sendTransfer({
        secretKey,
        seqno,
        messages: [
          internal({ to: toAddress, value: toNano(amountToDecimalString(amountTon, 9)), bounce: false }),
        ],
      });
    } catch (e) {
      sendError = e ?? new Error('TON send failed');
    }
    seed.fill(0);
    secretKey.fill(0);
    if (sendError) await settleTonSendFailure(sendError, client.sendAttempted, wallet.address.toString(), seqno, hash);

    return hash;
  } finally {
    seed.fill(0);
    secretKey?.fill(0);
  }
}

// ─── Send USDT Jetton ─────────────────────────────────────────────────────────

export async function sendUsdtTonRaw(
  tonPrivBytes: Uint8Array,
  toAddress:    string,
  amountUsdt:   number,
): Promise<string> {
  const seed = Buffer.from(tonPrivBytes);
  let secretKey: Buffer | null = null;
  try {
    const keyPair = keyPairFromSeed(seed);
    secretKey = keyPair.secretKey;
    const client  = new SendTrackingTonClient({ endpoint: TON_CENTER_RPC });
    const walletContract = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    const wallet = client.open(walletContract);

    const usdtMaster = client.open(JettonMaster.create(Address.parse(USDT_TON_MASTER)));
    const jettonWalletAddr = await usdtMaster.getWalletAddress(walletContract.address);

    const seqno = await wallet.getSeqno();
    const hash = `ton:seqno:${seqno}`;

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

    let sendError: unknown = null;
    try {
      await wallet.sendTransfer({
        secretKey,
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
    } catch (e) {
      sendError = e ?? new Error('TON send failed');
    }
    seed.fill(0);
    secretKey.fill(0);
    if (sendError) await settleTonSendFailure(sendError, client.sendAttempted, walletContract.address.toString(), seqno, hash);

    return hash;
  } finally {
    seed.fill(0);
    secretKey?.fill(0);
  }
}
