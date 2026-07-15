/**
 * lib/notifications-config.ts — shared config + pure decision logic for the
 * notification engine (задача 2.4). No secrets, no DB, no crypto — safe on both
 * client and server, and fully unit-testable.
 *
 * The engine (lib/server/notification-engine.ts) loads a user's rules, then asks
 * the pure helpers here whether a given (category, channel) should be delivered
 * right now. Keeping the policy pure is what makes «настройки соблюдаются» and
 * «дубликаты не доставляются» testable without a database.
 */

export type Channel = 'inbox' | 'telegram';
export type Category = 'transactional' | 'security' | 'price' | 'promotional';
export type NotificationKind =
  | 'tx_sent'
  | 'tx_failed'
  | 'claim_received'
  | 'security_alert'
  | 'price_alert'
  | 'weekly_recap';

/** Kind → category. Category drives which preference toggle & retention applies. */
export const KIND_CATEGORY: Record<NotificationKind, Category> = {
  tx_sent: 'transactional',
  tx_failed: 'transactional',
  claim_received: 'transactional',
  security_alert: 'security',
  price_alert: 'price',
  weekly_recap: 'promotional',
};

export function categoryOf(kind: NotificationKind): Category {
  return KIND_CATEGORY[kind];
}

/**
 * Retention (из плана): transactional + security — без лимита; promotional ≤ 2/нед.
 * price — считаем «мягко промо-подобным» по частоте, но по умолчанию без лимита
 * (пользователь сам их включает). Лимит применяется в engine к promotional.
 */
export const PROMO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PROMO_MAX_PER_WINDOW = 2;

export interface NotificationRules {
  telegramEnabled: boolean;
  transactionalEnabled: boolean;
  securityEnabled: boolean;
  priceEnabled: boolean;
  promotionalEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStartMin: number; // local minutes-from-midnight [0..1439]
  quietEndMin: number;
  tzOffsetMin: number; // user local offset from UTC, minutes [-840..840]
}

export const DEFAULT_RULES: NotificationRules = {
  telegramEnabled: false, // opt-in
  transactionalEnabled: true,
  securityEnabled: true,
  priceEnabled: true,
  promotionalEnabled: true,
  quietHoursEnabled: false,
  quietStartMin: 1320, // 22:00
  quietEndMin: 480, // 08:00
  tzOffsetMin: 0,
};

/** Is the user's category toggle on? Security is NEVER silenced (safety). */
export function categoryEnabled(rules: NotificationRules, category: Category): boolean {
  switch (category) {
    case 'transactional':
      return rules.transactionalEnabled;
    case 'security':
      return true; // security alerts cannot be disabled
    case 'price':
      return rules.priceEnabled;
    case 'promotional':
      return rules.promotionalEnabled;
  }
}

/** Local minutes-from-midnight at a given UTC time for the user's tz offset. */
export function localMinutes(nowUtcMs: number, tzOffsetMin: number): number {
  const totalMin = Math.floor(nowUtcMs / 60000) + tzOffsetMin;
  return ((totalMin % 1440) + 1440) % 1440;
}

/** True if `min` falls inside [start, end), handling the midnight wrap-around. */
export function inQuietWindow(min: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false; // empty window
  return startMin < endMin
    ? min >= startMin && min < endMin
    : min >= startMin || min < endMin; // wraps past midnight (e.g. 22:00 → 08:00)
}

export type Decision = { deliver: boolean; reason: string };

/** Inbox is a non-intrusive pull surface: deliver whenever the category is on. */
export function decideInbox(rules: NotificationRules, category: Category): Decision {
  if (!categoryEnabled(rules, category)) return { deliver: false, reason: 'category_off' };
  return { deliver: true, reason: 'ok' };
}

/**
 * Telegram is an intrusive push channel: needs opt-in + category on + (unless
 * security) outside quiet hours. Promo rate-limit is checked separately in the
 * engine (it needs a DB count), not here.
 */
export function decideTelegram(
  rules: NotificationRules,
  category: Category,
  nowUtcMs: number,
): Decision {
  if (!rules.telegramEnabled) return { deliver: false, reason: 'channel_off' };
  if (!categoryEnabled(rules, category)) return { deliver: false, reason: 'category_off' };
  if (category !== 'security' && rules.quietHoursEnabled) {
    const min = localMinutes(nowUtcMs, rules.tzOffsetMin);
    if (inQuietWindow(min, rules.quietStartMin, rules.quietEndMin)) {
      return { deliver: false, reason: 'quiet_hours' };
    }
  }
  return { deliver: true, reason: 'ok' };
}

/** Feature flag. Off by default — new channels/engine inert, legacy inbox unchanged. */
export function notificationsEngineEnabled(): boolean {
  return process.env.NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED === 'true';
}
