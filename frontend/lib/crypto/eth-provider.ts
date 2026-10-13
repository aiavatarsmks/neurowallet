/**
 * lib/crypto/eth-provider.ts
 * One shared Ethereum mainnet provider for balances, fees, sends and ENS.
 *
 * Why it exists: the old hardcoded https://cloudflare-eth.com stopped serving
 * wallet calls (eth_getBalance, eth_call, eth_getTransactionCount,
 * eth_gasPrice, eth_feeHistory, eth_sendRawTransaction answer -32603/-32046),
 * so ETH and USDT ERC-20 showed 0 and sends failed.
 *
 * Design:
 *  - ethers v6 FallbackProvider over three keyless public JSON-RPC endpoints,
 *    the same three hosts the CSP connect-src allows (next.config.js).
 *  - Each backend is pinned to chainId 1 (staticNetwork), so ethers never
 *    sends eth_chainId detection calls; batchMaxCount 1 because public RPCs
 *    throttle or reject JSON-RPC batches. Short HTTP timeout and a single
 *    429 retry, so a slow backend cannot hold a request for minutes.
 *  - quorum 1: the first answer wins. Stock FallbackProvider with quorum 1
 *    also takes the FIRST ERROR as the answer (it only moves on to the next
 *    backend when one stalls), so reads here fail over to the other backends
 *    on transport-type errors. Deterministic chain answers (a revert, not
 *    enough funds, nonce too low) are returned as they are, without retry.
 *  - Broadcast: the signed tx goes to every backend at once and the first
 *    backend that returns its hash wins. "already known" means that backend
 *    already holds this exact tx, so it counts as accepted. "nonce too low"
 *    or "replacement underpriced" count as accepted only if some backend can
 *    see the tx by hash; otherwise that rejection reaches the caller. No
 *    follow-up read runs after a successful broadcast, so a failing read can
 *    never turn an accepted tx into an error (and a retry into a double pay).
 *  - A priority-fee estimate of 0 counts as "no estimate", so ethers applies
 *    its own 1 gwei default tip, as it did with cloudflare-eth (see
 *    DEFAULT_TIP_WEI). Gas limit, base fee and everything else are unchanged.
 *  - Memoized. Rebuilt after a transport-level failure, because stock
 *    FallbackProvider drops for good any backend that failed its first
 *    eth_blockNumber sync (one offline moment would disable ETH until reload).
 *
 * TODO(prod): keyless public RPCs are rate limited and can stop serving
 * overnight (that is what happened to cloudflare-eth). Before real money, add
 * a keyed RPC (Alchemy or Infura) behind a server-side proxy route, so the key
 * never ships in the bundle, and keep these public endpoints as the fallback.
 * Not implemented here.
 */

import {
  AbstractProvider,
  FallbackProvider,
  FetchRequest,
  JsonRpcProvider,
  Network,
  Transaction,
  isError,
  type PerformActionRequest,
  type TransactionResponse,
  type TransactionResponseParams,
} from 'ethers';

/** Keyless mainnet RPCs, in priority order. Keep in sync with connect-src in next.config.js. */
export const ETH_RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth', // last: a relay that often answers 429 / HTML redirects under load
] as const;

const HTTP_TIMEOUT_MS = 10_000;
/**
 * Tip used when a backend has no usable priority-fee estimate. publicnode and
 * 1rpc answer eth_maxPriorityFeePerGas with 0x0 (checked 2026-10-13); a 0-tip
 * tx is refused by geth's default txpool (min tip 1 wei) or waits for hours.
 * 1 gwei is ethers' own default for a node without an estimate, i.e. what the
 * wallet used with cloudflare-eth (which answered "method not found" there),
 * so the fee policy stays as it was.
 */
const DEFAULT_TIP_WEI = 1_000_000_000n;
/** How long one backend may stay silent before the next one is asked in parallel. */
const STALL_TIMEOUT_MS = 1_500;

const mainnet = (): Network => Network.from(1);

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * The message the node itself sent in its JSON-RPC error, if any. ethers keeps
 * it at `info.error` (call/estimateGas, nonce/funds mapping) or at `error`
 * (UNKNOWN_ERROR). The ethers message is not used: it embeds words like
 * "missing revert data" that would fool the checks below.
 */
function nodeMessage(err: unknown): string {
  const e = err as { info?: { error?: { message?: unknown } }; error?: { message?: unknown } } | null;
  const msg = e?.info?.error?.message ?? e?.error?.message;
  return typeof msg === 'string' ? msg : '';
}

/**
 * An answer about the chain itself, the same on every honest node: a revert,
 * not enough funds, a used nonce, a bad argument. Everything else (HTTP
 * error, timeout, rate limit, -32603 "internal error", malformed body) is a
 * transport problem with that one backend and is worth trying elsewhere.
 */
export function isDeterministicChainError(err: unknown): boolean {
  if (isError(err, 'CALL_EXCEPTION')) {
    // Real reverts carry revert data or say "revert"; a transport failure on
    // eth_call / eth_estimateGas surfaces as CALL_EXCEPTION "missing revert data".
    if (err.data) return true;
    return /revert/i.test(nodeMessage(err));
  }
  return (
    isError(err, 'INSUFFICIENT_FUNDS') ||
    isError(err, 'NONCE_EXPIRED') ||
    isError(err, 'REPLACEMENT_UNDERPRICED') ||
    isError(err, 'INVALID_ARGUMENT') ||
    isError(err, 'NUMERIC_FAULT') ||
    isError(err, 'ACTION_REJECTED') ||
    isError(err, 'UNCONFIGURED_NAME')
  );
}

/** The node already holds this exact tx (geth/reth/erigon/nethermind/besu wordings). */
function isAlreadyKnown(err: unknown): boolean {
  return /already known|alreadyknown|known transaction|already exists|already imported/i.test(nodeMessage(err));
}

/** The nonce is taken: by this tx (accepted elsewhere) or by another one (real conflict). */
function isNonceConflict(err: unknown): boolean {
  return isError(err, 'NONCE_EXPIRED') || isError(err, 'REPLACEMENT_UNDERPRICED');
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

type BroadcastOutcome = { ok: true } | { ok: false; error: unknown };

async function broadcastOnce(backend: AbstractProvider, signedTx: string, expectedHash: string): Promise<BroadcastOutcome> {
  try {
    const hash: unknown = await backend._perform({ method: 'broadcastTransaction', signedTransaction: signedTx });
    if (typeof hash === 'string' && hash.toLowerCase() === expectedHash.toLowerCase()) return { ok: true };
    return { ok: false, error: new Error(`ETH broadcast: backend returned an unexpected hash (${String(hash)})`) };
  } catch (error) {
    if (isAlreadyKnown(error)) return { ok: true };
    return { ok: false, error };
  }
}

/** Resolves true as soon as one outcome is ok; false once all failed. */
function firstOk(attempts: Promise<BroadcastOutcome>[]): Promise<boolean> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    if (pending === 0) resolve(false);
    for (const a of attempts) {
      a.then((o) => {
        if (o.ok) resolve(true);
        pending -= 1;
        if (pending === 0) resolve(false);
      });
    }
  });
}

async function anyBackendSeesTx(backends: readonly AbstractProvider[], hash: string): Promise<boolean> {
  const found = await Promise.all(
    backends.map((b) => b.getTransaction(hash).then((tx) => tx != null, () => false)),
  );
  return found.some(Boolean);
}

/**
 * Send a signed tx to every backend; resolve with its hash on the first
 * acceptance. Exported for tests; production code goes through
 * EthFallbackProvider.broadcastTransaction (used by Wallet.sendTransaction).
 */
export async function broadcastToBackends(backends: readonly AbstractProvider[], signedTx: string): Promise<string> {
  const expectedHash = Transaction.from(signedTx).hash;
  if (!expectedHash) throw new Error('ETH broadcast: transaction is not signed');

  const attempts = backends.map((b) => broadcastOnce(b, signedTx, expectedHash));
  if (await firstOk(attempts)) return expectedHash;

  const errors = (await Promise.all(attempts)).flatMap((o) => (o.ok ? [] : [o.error]));
  if (errors.some(isNonceConflict) && (await anyBackendSeesTx(backends, expectedHash))) return expectedHash;
  // Prefer a chain answer (e.g. insufficient funds), then anything a node
  // said, over "no answer".
  throw (
    errors.find(isDeterministicChainError) ??
    errors.find((e) => nodeMessage(e) !== '') ??
    errors[0] ??
    new Error('ETH broadcast failed')
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class EthFallbackProvider extends FallbackProvider {
  readonly #backends: readonly AbstractProvider[];
  #needsRebuild = false;

  constructor(backends: readonly AbstractProvider[]) {
    super(
      backends.map((provider, i) => ({ provider, priority: i + 1, weight: 1, stallTimeout: STALL_TIMEOUT_MS })),
      mainnet(),
      { quorum: 1 },
    );
    this.#backends = backends;
  }

  /** true after a transport-level failure; getEthProvider() then builds a fresh instance. */
  get needsRebuild(): boolean {
    return this.#needsRebuild;
  }

  /** chainId is pinned to 1: no detection round-trip through the backends. */
  override async _detectNetwork(): Promise<Network> {
    return mainnet();
  }

  /** Read failover: on a transport-type error, ask the remaining backends in priority order. */
  override async _translatePerform(provider: AbstractProvider, req: PerformActionRequest): Promise<unknown> {
    try {
      return await super._translatePerform(provider, req);
    } catch (first) {
      if (isDeterministicChainError(first)) throw first;
      let last: unknown = first;
      for (const next of this.#backends) {
        if (next === provider) continue;
        try {
          return await super._translatePerform(next, req);
        } catch (err) {
          if (isDeterministicChainError(err)) throw err;
          last = err;
        }
      }
      throw last;
    }
  }

  override async _perform<T = unknown>(req: PerformActionRequest): Promise<T> {
    try {
      const result = await super._perform<T>(req);
      if (req.method === 'getPriorityFee' && (result == null || BigInt(result as bigint) === 0n)) {
        return DEFAULT_TIP_WEI as T;
      }
      return result;
    } catch (err) {
      if (!isDeterministicChainError(err)) this.#needsRebuild = true;
      throw err;
    }
  }

  override async broadcastTransaction(signedTx: string): Promise<TransactionResponse> {
    await broadcastToBackends(this.#backends, signedTx);
    const tx = Transaction.from(signedTx);
    // Same wrapping as AbstractProvider.broadcastTransaction, minus its extra
    // getBlockNumber() (only used by tx.wait() replacement tracking, which
    // the wallet does not call).
    return this._wrapTransactionResponse(tx as unknown as TransactionResponseParams, mainnet());
  }
}

function jsonRpcBackend(url: string): JsonRpcProvider {
  const req = new FetchRequest(url);
  req.timeout = HTTP_TIMEOUT_MS;
  req.setThrottleParams({ maxAttempts: 2 }); // one retry on HTTP 429, then fail over
  const network = mainnet();
  return new JsonRpcProvider(req, network, { staticNetwork: network, batchMaxCount: 1 });
}

/** Build a provider. `backends` is for tests; production uses ETH_RPC_URLS. */
export function createEthProvider(backends?: readonly AbstractProvider[]): EthFallbackProvider {
  return new EthFallbackProvider(backends ?? ETH_RPC_URLS.map(jsonRpcBackend));
}

let shared: EthFallbackProvider | null = null;

/** The app-wide ETH mainnet provider (memoized; rebuilt after a transport failure). */
export function getEthProvider(): EthFallbackProvider {
  if (!shared || shared.needsRebuild) shared = createEthProvider();
  return shared;
}

/** Drop the memoized instance (tests). In-flight calls keep their instance. */
export function resetEthProvider(): void {
  shared = null;
}
