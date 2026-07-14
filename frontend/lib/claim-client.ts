import { track, getSessionId, newTraceId } from './analytics';
import { buildClaimUrl, CLAIM_NETWORK, type ClaimAsset } from './claim-config';
import { supabase } from './supabase';

/**
 * lib/claim-client.ts — client side of claim links (задача 2.8, v1 demo).
 *
 * IMPORTANT (invariant): this module makes NO chain calls — it only talks to
 * /api/claim/*. The secret is generated here, the server only ever receives its
 * sha256; the raw secret lives in the shareable URL's fragment.
 */

const PENDING_KEY = 'nw_pending_claim';

function randomSecret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}

export type CreateClaimLinkResult = { url: string; ref: string } | { error: string };

/** Create a demo claim link and return the canonical shareable URL. */
export async function createClaimLink(opts: { asset: ClaimAsset; amount: number; appUrl: string }): Promise<CreateClaimLinkResult> {
  try {
    const secret = randomSecret();
    const secret_hash = await sha256Hex(secret);
    const dedupe_key = newTraceId(); // one active link per create action
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch('/api/claim/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        asset: opts.asset, network: CLAIM_NETWORK, amount: opts.amount,
        secret_hash, dedupe_key, is_demo: true, session_id: getSessionId(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error || 'failed' };
    track('claim_link_created', { asset: opts.asset, network: CLAIM_NETWORK, demo: true });
    return { url: buildClaimUrl(opts.appUrl, (body as { ref: string }).ref, secret), ref: (body as { ref: string }).ref };
  } catch {
    return { error: 'failed' };
  }
}

export interface ClaimStatusView {
  asset: string; network: string; amount: number; status: string; expiresAt: string; isDemo: boolean;
}

export async function fetchClaimStatus(ref: string): Promise<ClaimStatusView | null> {
  try {
    const res = await fetch(`/api/claim/status?ref=${encodeURIComponent(ref)}`);
    if (!res.ok) return null;
    return (await res.json()) as ClaimStatusView;
  } catch {
    return null;
  }
}

export type CompleteClaimResult = { ok: true; asset: string; amount: number } | { error: string };

/** Complete a claim (recipient must be signed in). Demo: no real credit. */
export async function completeClaim(ref: string, secret: string): Promise<CompleteClaimResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { error: 'unauthorized' };
    const res = await fetch('/api/claim/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ref, secret, session_id: getSessionId() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error || 'failed' };
    track('claim_completed', { asset: (body as { asset: string }).asset, network: CLAIM_NETWORK, demo: true });
    return { ok: true, asset: (body as { asset: string }).asset, amount: (body as { amount: number }).amount };
  } catch {
    return { error: 'failed' };
  }
}

// ── pending-claim handoff (open → onboard → claim) ──────────────────────────
export function savePendingClaim(ref: string, secret: string): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ref, secret })); } catch { /* ignore */ }
}
export function getPendingClaim(): { ref: string; secret: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return v && typeof v.ref === 'string' && typeof v.secret === 'string' ? v : null;
  } catch { return null; }
}
export function clearPendingClaim(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}
