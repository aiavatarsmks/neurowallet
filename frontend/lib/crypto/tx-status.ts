/**
 * lib/crypto/tx-status.ts
 * Post-send status of a broadcast transfer, for the done screen.
 *
 * Read-only: public explorer / RPC endpoints that are already in the CSP
 * connect-src (next.config.js). No keys, no signing, no writes. The result is
 * UI feedback, never an input to another chain action.
 *
 *   ETH / USDT ERC-20  eth_getTransactionReceipt (status 0x1 / 0x0 / null)
 *   BTC                blockstream /tx/{txid}/status, fallback mempool.space
 *   SOL                getSignatureStatuses (searchTransactionHistory)
 *   TRX / USDT TRC-20  TronGrid /wallet/gettransactioninfobyid (receipt.result)
 *   TON / USDT-TON     the send returns a synthetic 'ton:seqno:N' (ton-tx.ts);
 *                      the sender wallet's seqno > N means "processed by the
 *                      wallet contract", not proof that a jetton arrived.
 *
 * Errors: HTTP 429 / 5xx / network failures throw TxStatusFetchError so the
 * poller (hooks/useTxStatus.ts) backs off. Unparseable answers never claim
 * success or failure: they stay 'pending' or become 'unknown'.
 */

import { ETH_RPC_URLS } from './eth-provider';
import { solRpc } from './sol-rpc';

export type TxStatusCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';
export type TxState = 'pending' | 'confirmed' | 'failed' | 'unknown';

export interface TxStatus {
  state: TxState;
  /**
   * Stable machine code, mapped to text by the UI. For TRON failures it is the
   * chain's receipt result (OUT_OF_ENERGY, REVERT, …); otherwise one of
   * TX_STATUS_REASON.
   */
  reason?: string;
}

export interface TxStatusContext {
  /** Time since broadcast, ms: "not found yet" (pending) vs "probably gone" (unknown). */
  elapsedMs?: number;
  /** TON / USDT-TON: the sender's wallet address (its seqno is polled). */
  tonWalletAddress?: string;
  signal?: AbortSignal;
}

export const TX_STATUS_REASON = {
  ETH_REVERTED: 'reverted',
  SOL_ERROR: 'sol_error',
  SOL_MAYBE_EXPIRED: 'sol_maybe_expired',
  BTC_NOT_FOUND: 'btc_not_found',
  TON_NO_WALLET: 'ton_no_wallet',
  BAD_HASH: 'bad_hash',
} as const;

/** A SOL signature still unknown after this is likely expired (blockhash ~60–90 s). */
export const SOL_EXPIRY_MS = 2 * 60_000;
/** A BTC txid unknown to both explorers after this is reported as 'unknown'. */
export const BTC_NOT_FOUND_GRACE_MS = 10 * 60_000;

// Same keyless RPC list as the send path (lib/crypto/eth-provider.ts), queried
// with a plain eth_getTransactionReceipt so status polling stays dependency-light.
const ETH_RPCS: readonly string[] = ETH_RPC_URLS;
const BTC_APIS = ['https://blockstream.info/api', 'https://mempool.space/api'];
const TRONGRID = 'https://api.trongrid.io';
const TONCENTER = 'https://toncenter.com/api/v2';

/** Upstream unavailable or rate-limited (status null = network error). Retry later with backoff. */
export class TxStatusFetchError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'TxStatusFetchError';
    this.status = status;
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new TxStatusFetchError(null, `network error: ${url}`);
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new TxStatusFetchError(res.status, 'bad JSON');
  }
}

function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal);
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | null => (v && typeof v === 'object' ? (v as Json) : null);

// ─── ETH / USDT ERC-20 ────────────────────────────────────────────────────────

async function ethStatus(hash: string, ctx: TxStatusContext): Promise<TxStatus> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH };
  let lastErr: unknown = new TxStatusFetchError(null, 'no ETH RPC answered');
  for (const url of ETH_RPCS) {
    try {
      const res = await postJson(url, { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }, ctx.signal);
      if (!res.ok) throw new TxStatusFetchError(res.status, `ETH RPC HTTP ${res.status}`);
      const json = asObj(await readJson(res));
      if (!json || json.error) throw new TxStatusFetchError(res.status, 'ETH RPC error');
      const receipt = asObj(json.result);
      if (!receipt) return { state: 'pending' };
      if (receipt.status === '0x1') return { state: 'confirmed' };
      if (receipt.status === '0x0') return { state: 'failed', reason: TX_STATUS_REASON.ETH_REVERTED };
      return { state: 'unknown' };
    } catch (e) {
      if (isAbort(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── BTC ──────────────────────────────────────────────────────────────────────

async function btcStatus(txid: string, ctx: TxStatusContext): Promise<TxStatus> {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return { state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH };
  let notFound = false;
  let lastErr: unknown = null;
  for (const base of BTC_APIS) {
    try {
      // GET /tx/{txid}, not /tx/{txid}/status: the /status endpoint answers
      // 200 {"confirmed":false} even for a txid the explorer has never seen
      // (checked 2026-10-13), which would show a lost tx as "pending" forever.
      const res = await request(`${base}/tx/${txid}`, { method: 'GET' }, ctx.signal);
      if (res.status === 404) { notFound = true; continue; }
      if (!res.ok) throw new TxStatusFetchError(res.status, `BTC explorer HTTP ${res.status}`);
      const json = asObj(await readJson(res));
      const status = asObj(json?.status);
      if (!json || !status) throw new TxStatusFetchError(res.status, 'BTC explorer: bad body');
      // Known to the explorer: in a block → confirmed, otherwise waiting in the mempool.
      return status.confirmed === true ? { state: 'confirmed' } : { state: 'pending' };
    } catch (e) {
      if (isAbort(e)) throw e;
      lastErr = e;
    }
  }
  if (notFound) {
    // Right after broadcast an explorer may not have indexed the tx yet.
    return (ctx.elapsedMs ?? 0) < BTC_NOT_FOUND_GRACE_MS
      ? { state: 'pending' }
      : { state: 'unknown', reason: TX_STATUS_REASON.BTC_NOT_FOUND };
  }
  throw lastErr ?? new TxStatusFetchError(null, 'no BTC explorer answered');
}

// ─── SOL ──────────────────────────────────────────────────────────────────────

async function solStatus(signature: string, ctx: TxStatusContext): Promise<TxStatus> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return { state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH };
  let result: unknown;
  try {
    result = await solRpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }], { signal: ctx.signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new TxStatusFetchError(null, e instanceof Error ? e.message.slice(0, 120) : 'Solana RPC error');
  }
  const value = asObj(result)?.value;
  const st = Array.isArray(value) ? asObj(value[0]) : null;
  if (!st) {
    // Never seen: still propagating, or the blockhash expired and it never landed.
    return (ctx.elapsedMs ?? 0) < SOL_EXPIRY_MS
      ? { state: 'pending' }
      : { state: 'unknown', reason: TX_STATUS_REASON.SOL_MAYBE_EXPIRED };
  }
  if (st.err != null) return { state: 'failed', reason: TX_STATUS_REASON.SOL_ERROR };
  if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { state: 'confirmed' };
  return { state: 'pending' };
}

// ─── TRON (TRX, USDT TRC-20) ──────────────────────────────────────────────────

/** Chain result codes are shown to the user: only plain upper-case codes pass. */
function tronCode(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v) ? v : null;
}

async function tronStatus(coin: 'TRX' | 'TRC20', txid: string, ctx: TxStatusContext): Promise<TxStatus> {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return { state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH };
  const res = await postJson(`${TRONGRID}/wallet/gettransactioninfobyid`, { value: txid }, ctx.signal);
  if (!res.ok) throw new TxStatusFetchError(res.status, `TronGrid HTTP ${res.status}`);
  const info = asObj(await readJson(res));
  if (!info) throw new TxStatusFetchError(res.status, 'TronGrid: bad body');
  // {} until the transaction is in a block.
  if (typeof info.blockNumber !== 'number') return { state: 'pending' };

  const receiptResult = tronCode(asObj(info.receipt)?.result);
  const receiptFailed = receiptResult !== null && receiptResult !== 'SUCCESS';
  const txFailed = info.result === 'FAILED' || receiptFailed;
  const failReason = receiptFailed ? receiptResult! : 'FAILED';

  if (coin === 'TRC20') {
    // OUT_OF_ENERGY, REVERT, …: the transfer did not happen but the TRX fee was burned.
    if (txFailed) return { state: 'failed', reason: failReason };
    if (receiptResult === 'SUCCESS') return { state: 'confirmed' };
    return { state: 'unknown' }; // a contract call always has a receipt result
  }

  // Native TRX: no contract receipt; included in a block = done unless marked FAILED.
  if (txFailed) return { state: 'failed', reason: failReason };
  return { state: 'confirmed' };
}

// ─── TON / USDT-TON ───────────────────────────────────────────────────────────

async function tonStatus(hash: string, ctx: TxStatusContext): Promise<TxStatus> {
  const m = /^ton:seqno:(\d{1,10})$/.exec(hash);
  if (!m) return { state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH };
  const sentSeqno = Number(m[1]);
  const wallet = ctx.tonWalletAddress?.trim();
  if (!wallet) return { state: 'unknown', reason: TX_STATUS_REASON.TON_NO_WALLET };

  const res = await postJson(`${TONCENTER}/runGetMethod`, { address: wallet, method: 'seqno', stack: [] }, ctx.signal);
  if (res.status === 429 || res.status >= 500) throw new TxStatusFetchError(res.status, `toncenter HTTP ${res.status}`);
  const json = asObj(await readJson(res));
  if (!res.ok || !json || json.ok !== true) {
    // toncenter can report a rate limit in the body as well.
    if (json && json.code === 429) throw new TxStatusFetchError(429, 'toncenter rate limit');
    throw new TxStatusFetchError(res.status, 'toncenter error');
  }
  const result = asObj(json.result);
  // Uninitialized wallet (first send not processed yet): the get-method fails.
  if (!result || result.exit_code !== 0 || !Array.isArray(result.stack)) return { state: 'pending' };
  const top = result.stack[0];
  const raw = Array.isArray(top) && top[0] === 'num' ? top[1] : null;
  const current = typeof raw === 'string' && /^-?0x[0-9a-fA-F]+$/.test(raw) ? parseInt(raw, 16) : NaN;
  if (!Number.isFinite(current)) return { state: 'pending' };
  return current > sentSeqno ? { state: 'confirmed' } : { state: 'pending' };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function getTxStatus(
  coin: TxStatusCoin,
  hash: string,
  ctx: TxStatusContext = {},
): Promise<TxStatus> {
  const h = (hash ?? '').trim();
  switch (coin) {
    case 'ETH':
    case 'USDT':
      return ethStatus(h, ctx);
    case 'BTC':
      return btcStatus(h, ctx);
    case 'SOL':
      return solStatus(h, ctx);
    case 'TRX':
    case 'TRC20':
      return tronStatus(coin, h, ctx);
    case 'TON':
    case 'USDT_TON':
      return tonStatus(h, ctx);
    default:
      return { state: 'unknown' };
  }
}

/** Terminal states end polling. */
export function isFinalTxState(state: TxState): boolean {
  return state === 'confirmed' || state === 'failed' || state === 'unknown';
}
