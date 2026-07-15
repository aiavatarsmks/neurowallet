import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextApiRequest } from 'next';
import { dispatchNotification } from './notification-engine';
import type { Lang } from './notifications';
import {
  EMPTY_COUNTS,
  RECAP_SOURCE_EVENTS,
  RECAP_EVENT_FIELD,
  RECAP_WINDOW_MS,
  buildRecapSummary,
  hasActivity,
  isoWeekKey,
  type RecapCounts,
} from '../recap-content';

/**
 * lib/server/recap.ts — weekly AI recap generator (задача 2.7).
 *
 * Flow: read the user's factual analytics_events over the trailing 7 days →
 * count relevant actions → compose a SAFE summary (counts only, no amounts/
 * addresses) → dispatch a `weekly_recap` (promotional) through the 2.4 engine,
 * which applies preferences, quiet hours, the promo rate-limit and per-ISO-week
 * dedup. Nothing is invented: an empty week yields no recap. Never throws.
 */

export type RecapStatus = 'sent' | 'deduped' | 'suppressed' | 'empty' | 'skipped';

function svc(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

/** Count this user's recap-relevant events in the trailing window (service role). */
export async function aggregateWeek(
  db: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<RecapCounts> {
  const counts: RecapCounts = { ...EMPTY_COUNTS };
  try {
    const { data } = await db
      .from('analytics_events')
      .select('event')
      .eq('user_id', userId)
      .in('event', RECAP_SOURCE_EVENTS as string[])
      .gte('created_at', sinceIso);
    for (const row of (data as { event: string }[] | null) ?? []) {
      const field = RECAP_EVENT_FIELD[row.event];
      if (field) counts[field] += 1;
    }
  } catch {
    /* table missing / offline → zero counts → treated as empty week */
  }
  return counts;
}

export interface RecapInput {
  userId: string;
  lang?: Lang;
  telegramId?: number | null;
  nowMs?: number;
  req?: NextApiRequest;
}

export interface RecapResult {
  status: RecapStatus;
  counts: RecapCounts;
}

/**
 * Build and deliver this user's weekly recap. Idempotent per ISO week via the
 * engine dedupe key. Returns `empty` when there was no activity to report.
 */
export async function generateWeeklyRecap(input: RecapInput): Promise<RecapResult> {
  const db = svc();
  if (!db) return { status: 'skipped', counts: { ...EMPTY_COUNTS } };

  const nowMs = input.nowMs ?? Date.now();
  const lang: Lang = input.lang === 'en' ? 'en' : 'ru';
  const sinceIso = new Date(nowMs - RECAP_WINDOW_MS).toISOString();

  const counts = await aggregateWeek(db, input.userId, sinceIso);
  if (!hasActivity(counts)) return { status: 'empty', counts };

  const summary = buildRecapSummary(counts, lang);
  if (!summary) return { status: 'empty', counts };

  const res = await dispatchNotification({
    userId: input.userId,
    kind: 'weekly_recap',
    lang,
    meta: { summary },
    dedupeKey: isoWeekKey(nowMs), // one recap per user per ISO week
    telegramId: input.telegramId ?? null,
    req: input.req,
  });

  // Inbox is the recap's primary surface; report its outcome as the status.
  const status: RecapStatus =
    res.inbox === 'sent' ? 'sent' : res.inbox === 'deduped' ? 'deduped' : 'suppressed';
  return { status, counts };
}
