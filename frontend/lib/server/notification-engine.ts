import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextApiRequest } from 'next';
import { writeAuditLog } from './api-security';
import { writeNotification, composeNotification, type Lang } from './notifications';
import {
  DEFAULT_RULES,
  PROMO_MAX_PER_WINDOW,
  PROMO_WINDOW_MS,
  categoryOf,
  decideInbox,
  decideTelegram,
  type Channel,
  type NotificationKind,
  type NotificationRules,
} from '../notifications-config';

/**
 * lib/server/notification-engine.ts — rule engine + delivery (задача 2.4).
 *
 * Flow: event → load user rules → per channel apply the pure policy
 * (notifications-config) → dedup + promo rate-limit against notification_deliveries
 * → deliver (inbox insert / Telegram send) → record a deliveries row → audit the
 * critical kinds. Never throws: a failed notification must never break the caller
 * (a real tx, a claim). All writes are service role (RLS denies client writes).
 *
 * Categories with unlimited retention: transactional + security. Promotional is
 * capped at PROMO_MAX_PER_WINDOW per 7 days (retention policy from the plan).
 */

const CRITICAL_KINDS: ReadonlySet<NotificationKind> = new Set([
  'tx_failed',
  'security_alert',
  'claim_received',
]);

function svc(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

/** Map a DB notification_rules row to the pure NotificationRules shape. */
function rowToRules(row: Record<string, unknown> | null): NotificationRules {
  if (!row) return DEFAULT_RULES;
  return {
    telegramEnabled: !!row.telegram_enabled,
    transactionalEnabled: !!row.transactional_enabled,
    securityEnabled: !!row.security_enabled,
    priceEnabled: !!row.price_enabled,
    promotionalEnabled: !!row.promotional_enabled,
    quietHoursEnabled: !!row.quiet_hours_enabled,
    quietStartMin: Number(row.quiet_start_min ?? DEFAULT_RULES.quietStartMin),
    quietEndMin: Number(row.quiet_end_min ?? DEFAULT_RULES.quietEndMin),
    tzOffsetMin: Number(row.tz_offset_min ?? DEFAULT_RULES.tzOffsetMin),
  };
}

export async function loadRules(db: SupabaseClient, userId: string): Promise<NotificationRules> {
  try {
    const { data } = await db.from('notification_rules').select('*').eq('user_id', userId).maybeSingle();
    return rowToRules(data as Record<string, unknown> | null);
  } catch {
    return DEFAULT_RULES; // table missing / offline → safe defaults
  }
}

/** promotional deliveries actually SENT in the trailing window (retention cap).
 * Best-effort: on a query error returns 0 (fail-open) so a transient DB hiccup
 * never throws out of dispatch — the caller (a real tx/claim) must not break. */
async function promoSentInWindow(db: SupabaseClient, userId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - PROMO_WINDOW_MS).toISOString();
    const { count } = await db
      .from('notification_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', 'promotional')
      .eq('status', 'sent')
      .gte('created_at', since);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Was this exact event already SENT to this channel? (idempotent dedup)
 * Best-effort: on a query error returns false — the DB unique index on
 * (user, channel, dedupe_key) WHERE status='sent' is the real dedup guarantee,
 * so a failed pre-check can never produce an actual duplicate row. */
async function alreadySent(
  db: SupabaseClient,
  userId: string,
  channel: Channel,
  dedupeKey: string | null,
): Promise<boolean> {
  if (!dedupeKey) return false;
  try {
    const { count } = await db
      .from('notification_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('channel', channel)
      .eq('dedupe_key', dedupeKey)
      .eq('status', 'sent');
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function recordDelivery(
  db: SupabaseClient,
  row: {
    userId: string;
    kind: NotificationKind;
    category: string;
    channel: Channel;
    status: 'sent' | 'suppressed' | 'deduped' | 'failed';
    reason: string;
    dedupeKey: string | null;
  },
): Promise<void> {
  try {
    await db.from('notification_deliveries').insert({
      user_id: row.userId,
      kind: row.kind,
      category: row.category,
      channel: row.channel,
      status: row.status,
      reason: row.reason,
      dedupe_key: row.dedupeKey,
    });
  } catch {
    /* best-effort journal */
  }
}

async function sendTelegram(telegramId: number, text: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export interface DispatchInput {
  userId: string;
  kind: NotificationKind;
  lang?: Lang;
  meta?: Record<string, string>;
  /** Idempotency key for the whole event (dedup across channels). */
  dedupeKey?: string | null;
  /** Present only if the user opted into Telegram and has a linked account. */
  telegramId?: number | null;
  req?: NextApiRequest;
}

export interface DispatchResult {
  inbox: 'sent' | 'suppressed' | 'deduped' | 'skipped';
  telegram: 'sent' | 'suppressed' | 'deduped' | 'skipped';
}

/**
 * Deliver one notification through the engine. Applies preferences, quiet hours,
 * dedup and the promotional rate-limit; records deliveries; audits critical kinds.
 */
export async function dispatchNotification(input: DispatchInput): Promise<DispatchResult> {
  const result: DispatchResult = { inbox: 'skipped', telegram: 'skipped' };
  const db = svc();
  if (!db) return result;

  const lang: Lang = input.lang === 'en' ? 'en' : 'ru';
  const meta = input.meta ?? {};
  const dedupeKey = input.dedupeKey ?? null;
  const category = categoryOf(input.kind);
  const nowMs = Date.now();

  const rules = await loadRules(db, input.userId);

  // ── Inbox channel (non-intrusive pull surface) ──────────────────────────────
  const inbox = decideInbox(rules, category);
  if (!inbox.deliver) {
    result.inbox = 'suppressed';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'inbox', status: 'suppressed', reason: inbox.reason, dedupeKey });
  } else if (await alreadySent(db, input.userId, 'inbox', dedupeKey)) {
    result.inbox = 'deduped';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'inbox', status: 'deduped', reason: 'duplicate', dedupeKey });
  } else {
    const wrote = await writeNotification(input.userId, input.kind, lang, meta, dedupeKey ?? undefined);
    result.inbox = wrote === 'inserted' ? 'sent' : 'deduped';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'inbox', status: result.inbox === 'sent' ? 'sent' : 'deduped', reason: result.inbox === 'sent' ? 'ok' : 'duplicate', dedupeKey });
  }

  // ── Telegram channel (intrusive push: opt-in, quiet hours, promo cap) ────────
  const tg = decideTelegram(rules, category, nowMs);
  if (!tg.deliver) {
    result.telegram = 'suppressed';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'telegram', status: 'suppressed', reason: tg.reason, dedupeKey });
  } else if (!input.telegramId) {
    result.telegram = 'suppressed';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'telegram', status: 'suppressed', reason: 'channel_off', dedupeKey });
  } else if (await alreadySent(db, input.userId, 'telegram', dedupeKey)) {
    result.telegram = 'deduped';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'telegram', status: 'deduped', reason: 'duplicate', dedupeKey });
  } else if (category === 'promotional' && (await promoSentInWindow(db, input.userId)) >= PROMO_MAX_PER_WINDOW) {
    result.telegram = 'suppressed';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'telegram', status: 'suppressed', reason: 'rate_limited', dedupeKey });
  } else {
    const composed = composeNotification(input.kind, lang, meta);
    const text = composed ? `<b>${composed.title}</b>\n${composed.body}` : '';
    const ok = text ? await sendTelegram(input.telegramId, text) : false;
    result.telegram = ok ? 'sent' : 'skipped';
    await recordDelivery(db, { userId: input.userId, kind: input.kind, category, channel: 'telegram', status: ok ? 'sent' : 'failed', reason: ok ? 'ok' : 'error', dedupeKey });
  }

  // ── Audit critical kinds that were actually delivered somewhere ──────────────
  if (input.req && CRITICAL_KINDS.has(input.kind) && (result.inbox === 'sent' || result.telegram === 'sent')) {
    try {
      await writeAuditLog(
        input.userId,
        'notification_delivered',
        { kind: input.kind, category, inbox: result.inbox, telegram: result.telegram },
        input.req,
      );
    } catch {
      /* audit is best-effort — never break the caller over a log write */
    }
  }

  return result;
}
