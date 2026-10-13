/**
 * lib/crypto/sol-rpc.ts
 * One Solana JSON-RPC entry point for the browser and the server.
 *
 * Why: api.mainnet-beta.solana.com answers 403 "Access forbidden" to any
 * request that carries an Origin header (checked 2026-10-13), i.e. to every
 * browser and the Telegram WebView. SOL balance, fee and send were broken for
 * real users while server-side calls kept working.
 *
 * Order in the browser:
 *   1. https://solana-rpc.publicnode.com directly (CORS *, keyless).
 *   2. /api/sol-rpc, our same-origin proxy (needs a Supabase session). The
 *      server has no Origin header, so it can use the official RPC, and it
 *      takes a keyed provider from SOLANA_RPC_URL (server env) when set.
 * Order on the server (Node, no Origin): official RPC, then publicnode.
 *
 * Errors:
 *   - Transport problems (network, non-2xx, 403/429/-32603 inside JSON-RPC,
 *     malformed body) move on to the next endpoint.
 *   - A real JSON-RPC answer (e.g. sendTransaction preflight "insufficient
 *     funds for rent") is returned to the caller as SolRpcError right away.
 *     Re-sending the same signed bytes elsewhere would give the same answer.
 *   - sendSol (transactions.ts) turns SolRpcUnavailableError on
 *     sendTransaction into a getSignatureStatuses lookup and, if the
 *     signature is not found, BroadcastOutcomeUnknownError (broadcast-error.ts).
 * Nothing secret goes through here: only public keys, signed transactions,
 * signatures.
 */

export const SOL_BROWSER_RPC_URLS = ['https://solana-rpc.publicnode.com'] as const;
export const SOL_SERVER_RPC_URLS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'] as const;
export const SOL_PROXY_PATH = '/api/sol-rpc';

/** Methods the wallet uses. The proxy accepts only these. */
export const SOL_RPC_METHODS = [
  'getBalance',
  'getLatestBlockhash',
  'sendTransaction',
  'getSignatureStatuses',
  'getMinimumBalanceForRentExemption',
  'getFeeForMessage',
  'getAccountInfo',
  'getSignaturesForAddress',
  'getTransaction',
  'getTokenAccountsByOwner',
] as const;
export type SolRpcMethod = (typeof SOL_RPC_METHODS)[number];

const DEFAULT_TIMEOUT_MS = 10_000;

/** A real answer from a Solana node (not a transport problem). */
export class SolRpcError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.name = 'SolRpcError';
    this.code = code;
  }
}

/** Every endpoint failed at the transport level. */
export class SolRpcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolRpcUnavailableError';
  }
}

type RpcBody = { result?: unknown; error?: { code?: unknown; message?: unknown } | null };

/**
 * JSON-RPC error codes that mean "this endpoint refuses us / failed", not "the
 * chain says no". -32603 (internal error) is the JSON-RPC twin of an HTTP 5xx:
 * for sendTransaction it says nothing about whether the bytes were forwarded,
 * so it must not end the send as a definitive rejection.
 */
function isTransportRpcError(code: unknown): boolean {
  return code === 403 || code === 429 || code === -32005 || code === -32029 || code === -32052 || code === 35
    || code === -32603;
}

export interface SolRpcOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test hook / server override of the endpoint list. */
  urls?: readonly string[];
  /** Bearer token for the same-origin proxy (browser). Resolved lazily when omitted. */
  getProxyToken?: () => Promise<string | null>;
}

async function postWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

/**
 * One attempt against one endpoint. Returns the result, throws SolRpcError for
 * a real node answer, returns a string (reason) for a transport failure.
 */
async function attempt<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await postWithTimeout(url, init, timeoutMs, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, reason: `${url}: network` };
  }
  let body: RpcBody | null = null;
  try {
    body = (await res.json()) as RpcBody;
  } catch {
    return { ok: false, reason: `${url}: HTTP ${res.status} non-JSON` };
  }
  if (body?.error) {
    const code = body.error.code ?? null;
    if (!res.ok || isTransportRpcError(code)) return { ok: false, reason: `${url}: rpc ${String(code)}` };
    throw new SolRpcError(String(body.error.message ?? 'Solana RPC error'), typeof code === 'number' ? code : null);
  }
  if (!res.ok) return { ok: false, reason: `${url}: HTTP ${res.status}` };
  if (!body || !('result' in body)) return { ok: false, reason: `${url}: malformed` };
  return { ok: true, value: body.result as T };
}

async function defaultProxyToken(): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Call a Solana JSON-RPC method with endpoint failover. Resolves with `result`.
 * Throws SolRpcError for a real node error, SolRpcUnavailableError when no
 * endpoint answered.
 */
export async function solRpc<T = unknown>(method: SolRpcMethod, params: unknown[], opts: SolRpcOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inBrowser = typeof window !== 'undefined';
  const urls = opts.urls ?? (inBrowser ? SOL_BROWSER_RPC_URLS : SOL_SERVER_RPC_URLS);
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const reasons: string[] = [];

  for (const url of urls) {
    const r = await attempt<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }, timeoutMs, opts.signal);
    if (r.ok) return r.value;
    reasons.push(r.reason);
  }

  if (inBrowser && !opts.urls) {
    const token = await (opts.getProxyToken ?? defaultProxyToken)();
    if (token) {
      const r = await attempt<T>(SOL_PROXY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ method, params }),
      }, timeoutMs, opts.signal);
      if (r.ok) return r.value;
      reasons.push(r.reason);
    } else {
      reasons.push(`${SOL_PROXY_PATH}: no session`);
    }
  }

  throw new SolRpcUnavailableError(`Solana RPC unavailable (${reasons.join('; ')})`);
}
