import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { CLAIM_EXPIRY_DAYS, CLAIM_MAX_ACTIVE_PER_USER, CLAIM_MAX_PER_DAY } from '../claim-config';

/**
 * lib/server/claim.ts — service-role claim-link logic (задача 2.8, v1 demo).
 * Never stores the raw secret (only sha256). Status transitions are atomic
 * (compare-and-set) so a link can't be double-claimed. Inserts/updates are
 * service role only (RLS denies client writes).
 */

const ACTIVE = ['created', 'funded'] as const;
const DAY_MS = 86_400_000;

function svc(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

type ClaimEvent = 'created' | 'opened' | 'claimed' | 'expired' | 'returned';

async function writeEvent(
  db: SupabaseClient,
  claimId: string,
  event: ClaimEvent,
  actorUserId: string | null,
  sessionId: string | null,
  meta: Record<string, unknown> | null,
): Promise<void> {
  try {
    await db.from('claim_events').insert({
      claim_id: claimId, event, actor_user_id: actorUserId, session_id: sessionId, meta,
    });
  } catch { /* best-effort */ }
}

export interface CreateClaimInput {
  senderUserId: string | null;
  senderSessionId: string | null;
  asset: string;
  network: string;
  amount: number;
  secretHash: string;
  dedupeKey: string;
  isDemo: boolean;
  targetTgId?: string | null;
  requireAuth?: boolean;
}

export type CreateClaimResult = { id: string; expiresAt: string } | { error: string };

/** Create (or return existing active) claim link. Idempotent on dedupe_key. */
export async function createClaim(input: CreateClaimInput): Promise<CreateClaimResult> {
  const db = svc();
  if (!db) return { error: 'unavailable' };

  // Idempotency: one active link per transfer.
  const existing = await db
    .from('claim_links').select('id, expires_at')
    .eq('dedupe_key', input.dedupeKey).in('status', ACTIVE as unknown as string[]).maybeSingle();
  if (existing.data) return { id: existing.data.id, expiresAt: existing.data.expires_at };

  const col = input.senderUserId ? 'sender_user_id' : 'sender_session_id';
  const val = input.senderUserId ?? input.senderSessionId;
  if (!val) return { error: 'no_sender' };

  const active = await db.from('claim_links')
    .select('id', { count: 'exact', head: true })
    .in('status', ACTIVE as unknown as string[]).eq(col, val);
  if ((active.count ?? 0) >= CLAIM_MAX_ACTIVE_PER_USER) return { error: 'too_many_active' };

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const today = await db.from('claim_links')
    .select('id', { count: 'exact', head: true }).eq(col, val).gte('created_at', since);
  if ((today.count ?? 0) >= CLAIM_MAX_PER_DAY) return { error: 'too_many_today' };

  const expiresAt = new Date(Date.now() + CLAIM_EXPIRY_DAYS * DAY_MS).toISOString();
  // v1 demo: created → funded immediately (no real funding step, no chain).
  const ins = await db.from('claim_links').insert({
    sender_user_id: input.senderUserId,
    sender_session_id: input.senderSessionId,
    asset: input.asset, network: input.network, amount: input.amount,
    secret_hash: input.secretHash, dedupe_key: input.dedupeKey, is_demo: input.isDemo,
    target_tg_id: input.targetTgId ?? null, require_auth: input.requireAuth ?? false,
    status: 'funded', expires_at: expiresAt,
  }).select('id, expires_at').single();

  if (ins.error || !ins.data) {
    // Lost a race on the active-dedupe unique index — return the winner.
    const won = await db.from('claim_links').select('id, expires_at')
      .eq('dedupe_key', input.dedupeKey).in('status', ACTIVE as unknown as string[]).maybeSingle();
    if (won.data) return { id: won.data.id, expiresAt: won.data.expires_at };
    return { error: 'insert_failed' };
  }
  await writeEvent(db, ins.data.id, 'created', input.senderUserId, input.senderSessionId, { is_demo: input.isDemo });
  return { id: ins.data.id, expiresAt: ins.data.expires_at };
}

export interface ClaimStatus {
  asset: string; network: string; amount: number;
  status: string; expiresAt: string; isDemo: boolean;
}

/** Non-sensitive status by ref, with lazy expiry (never returns the secret_hash). */
export async function getClaimStatus(ref: string): Promise<ClaimStatus | null> {
  const db = svc();
  if (!db) return null;
  const { data } = await db.from('claim_links')
    .select('id, asset, network, amount, status, expires_at, is_demo').eq('id', ref).maybeSingle();
  if (!data) return null;

  let status = data.status as string;
  if ((ACTIVE as unknown as string[]).includes(status) && new Date(data.expires_at).getTime() < Date.now()) {
    const upd = await db.from('claim_links')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', ref).in('status', ACTIVE as unknown as string[]).select('id').maybeSingle();
    if (upd.data) { await writeEvent(db, ref, 'expired', null, null, null); status = 'expired'; }
  }
  return { asset: data.asset, network: data.network, amount: Number(data.amount), status, expiresAt: data.expires_at, isDemo: data.is_demo };
}

export type CompleteClaimResult =
  | { ok: true; asset: string; network: string; amount: number; isDemo: boolean; senderUserId: string | null }
  | { error: string };

/** Verify secret + atomically claim (funded → claimed). Compare-and-set: no double-claim. */
export async function completeClaim(
  ref: string, secret: string, claimerUserId: string, sessionId: string | null,
): Promise<CompleteClaimResult> {
  const db = svc();
  if (!db) return { error: 'unavailable' };
  const { data: row } = await db.from('claim_links')
    .select('id, asset, network, amount, status, expires_at, is_demo, secret_hash, target_tg_id, require_auth, sender_user_id')
    .eq('id', ref).maybeSingle();
  if (!row) return { error: 'not_found' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.from('claim_links').update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', ref).in('status', ACTIVE as unknown as string[]);
    return { error: 'expired' };
  }
  if (row.status !== 'funded') return { error: 'not_claimable' };
  if (!secret || sha256Hex(secret) !== row.secret_hash) return { error: 'bad_secret' };

  const upd = await db.from('claim_links')
    .update({ status: 'claimed', claimed_by_user_id: claimerUserId, updated_at: new Date().toISOString() })
    .eq('id', ref).eq('status', 'funded') // compare-and-set
    .select('id').maybeSingle();
  if (!upd.data) return { error: 'already_claimed' };

  await writeEvent(db, ref, 'claimed', claimerUserId, sessionId, { is_demo: row.is_demo });
  return { ok: true, asset: row.asset, network: row.network, amount: Number(row.amount), isDemo: row.is_demo, senderUserId: row.sender_user_id ?? null };
}
