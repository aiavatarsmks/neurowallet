import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { solanaRpcUrl } from '@/lib/server/provider-keys';
import { ed25519 } from '@noble/curves/ed25519';
import { SOL_RPC_METHODS, SOL_SERVER_RPC_URLS, solRpc, SolRpcError, type SolRpcMethod } from '@/lib/crypto/sol-rpc';

/**
 * pages/api/sol-rpc.ts
 * Same-origin Solana JSON-RPC proxy, the browser's fallback (lib/crypto/sol-rpc.ts).
 *
 * The official RPC refuses browser requests (403 on any Origin header), so the
 * server, which sends no Origin, can reach it. With SOLANA_RPC_URL set (server
 * env, keyed provider) that endpoint goes first.
 *
 * - Supabase JWT required + per-user rate limit: not an open RPC relay.
 * - Only the wallet's methods (SOL_RPC_METHODS), params must be a small array.
 * - sendTransaction relays only the one transaction shape the wallet builds
 *   (lib/crypto/transactions.ts buildSolMessage): a signed legacy
 *   SystemProgram.transfer. Anything else is 400, so the keyed provider is
 *   not a relay for arbitrary transactions.
 * - Public data only: addresses, signed transactions, signatures. No audit_log
 *   write (balance polling would flood it); the send itself is audited elsewhere.
 * - Response mirrors JSON-RPC: { result } or { error: { code, message } }.
 */

const MAX_BODY_CHARS = 8_192;

// ─── sendTransaction: the wallet's SOL transfer, nothing else ────────────────
//
// Wire format (legacy message, see buildSolMessage):
//   tx  = [1 = signature count][64 signature][message]
//   msg = [1, 0, 1] header | [3] key count | from | to | System Program (32 × 0)
//         | blockhash(32) | [1] ix count | [2] program index | [2] account count
//         | [0, 1] accounts | [12] data length | u32 LE 2 (Transfer) | u64 LE lamports
const SOL_MSG_LEN = 3 + 1 + 3 * 32 + 32 + 6 + 12; // 150
const SOL_TX_LEN = 1 + 64 + SOL_MSG_LEN;          // 215
const SOL_IX_PREFIX = [1, 2, 2, 0, 1, 12] as const;
const SOL_SEND_CONFIG_KEYS = new Set(['encoding', 'preflightCommitment']);
const SOL_COMMITMENTS = new Set(['processed', 'confirmed', 'finalized']);

/** Strict base64 → bytes (canonical padding, no whitespace); null if not exactly that. */
function decodeBase64Strict(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.toString('base64') === s ? new Uint8Array(buf) : null;
}

/**
 * true only for [base64 tx, {encoding:'base64', preflightCommitment?}] where tx
 * is a correctly signed, single SystemProgram.transfer of > 0 lamports from the
 * signer (key 0) to key 1, in the exact layout the wallet produces.
 */
function isWalletSolTransfer(params: unknown[]): boolean {
  if (params.length !== 2) return false;
  const [raw, cfg] = params;
  if (typeof raw !== 'string' || !cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return false;
  const config = cfg as Record<string, unknown>;
  if (config.encoding !== 'base64') return false;
  if (Object.keys(config).some((k) => !SOL_SEND_CONFIG_KEYS.has(k))) return false;
  if (config.preflightCommitment !== undefined
      && !(typeof config.preflightCommitment === 'string' && SOL_COMMITMENTS.has(config.preflightCommitment))) return false;

  const tx = decodeBase64Strict(raw);
  if (!tx || tx.length !== SOL_TX_LEN || tx[0] !== 1) return false;
  const signature = tx.subarray(1, 65);
  const msg = tx.subarray(65);

  // Legacy header (top bit clear): 1 signer, 0 read-only signed, 1 read-only unsigned; 3 keys.
  if (msg[0] !== 1 || msg[1] !== 0 || msg[2] !== 1 || msg[3] !== 3) return false;
  const from = msg.subarray(4, 36);
  const program = msg.subarray(68, 100);
  if (!program.every((b) => b === 0)) return false; // 11111111111111111111111111111111
  if (from.every((b) => b === 0)) return false;

  const ix = msg.subarray(132);
  if (SOL_IX_PREFIX.some((b, i) => ix[i] !== b)) return false;
  const data = new DataView(ix.buffer, ix.byteOffset + SOL_IX_PREFIX.length, 12);
  if (data.getUint32(0, true) !== 2) return false;   // SystemInstruction::Transfer
  if (data.getUint32(4, true) === 0 && data.getUint32(8, true) === 0) return false; // 0 lamports

  try {
    return ed25519.verify(signature, msg, from, { zip215: false });
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: -32600, message: 'Method not allowed' } });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: { code: 401, message: 'Unauthorized' } });
  }

  if (!(await checkRateLimit(`sol-rpc:${auth.user.id}`, 60))) {
    return res.status(429).json({ error: { code: 429, message: 'Rate limit exceeded' } });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { method?: unknown; params?: unknown };
  const method = body.method;
  const params = body.params;
  if (typeof method !== 'string' || !(SOL_RPC_METHODS as readonly string[]).includes(method)) {
    return res.status(400).json({ error: { code: -32601, message: 'Method not allowed' } });
  }
  if (!Array.isArray(params) || params.length > 4 || JSON.stringify(params).length > MAX_BODY_CHARS) {
    return res.status(400).json({ error: { code: -32602, message: 'Invalid params' } });
  }
  if (method === 'sendTransaction' && !isWalletSolTransfer(params)) {
    return res.status(400).json({ error: { code: -32602, message: 'Transaction not allowed' } });
  }

  const keyed = solanaRpcUrl();
  const urls = keyed ? [keyed, ...SOL_SERVER_RPC_URLS] : [...SOL_SERVER_RPC_URLS];

  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await solRpc(method as SolRpcMethod, params, { urls, timeoutMs: 8_000 });
    return res.status(200).json({ jsonrpc: '2.0', id: 1, result });
  } catch (e) {
    if (e instanceof SolRpcError) {
      // A real node answer (e.g. preflight failure): pass it through unchanged.
      return res.status(200).json({ jsonrpc: '2.0', id: 1, error: { code: e.code, message: e.message.slice(0, 300) } });
    }
    console.warn('[sol-rpc] all upstreams failed:', e instanceof Error ? e.message.slice(0, 300) : e);
    return res.status(502).json({ error: { code: 502, message: 'Solana RPC unavailable' } });
  }
}
