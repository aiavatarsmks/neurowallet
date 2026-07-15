/**
 * lib/recap-content.ts — pure content + config for the weekly AI recap (задача 2.7).
 * No DB, no secrets, no crypto — safe on client and server, fully unit-testable.
 *
 * Invariants (CLAUDE.md + план):
 *  - Recap собирается ТОЛЬКО из фактических данных (счётчики событий недели);
 *    здесь — чистая сборка текста из уже посчитанных counts. Никаких выдумок.
 *  - НИКАКОЙ чувствительной информации: только счётчики действий и нейтральные
 *    формулировки — ни сумм, ни адресов, ни тикеров конкретных балансов.
 *  - Пустая неделя → null: не шлём «пустой» рекап (anti-spam, promotional cap).
 */

export type Lang = 'ru' | 'en';

/**
 * Factual weekly counts, each derived from analytics_events over the trailing 7
 * days for one user. All are non-negative integers; none carries an amount.
 */
export interface RecapCounts {
  sends: number; // send_succeeded
  risksFlagged: number; // risk_flagged — «Нейра как слой безопасности» (GTM)
  claimsSent: number; // claim_link_created
  claimsReceived: number; // claim_completed
  aiUsed: number; // ai_chat_used + ai_explain_used
}

/** analytics_events.event → which RecapCounts field it increments. */
export const RECAP_EVENT_FIELD: Record<string, keyof RecapCounts> = {
  send_succeeded: 'sends',
  risk_flagged: 'risksFlagged',
  claim_link_created: 'claimsSent',
  claim_completed: 'claimsReceived',
  ai_chat_used: 'aiUsed',
  ai_explain_used: 'aiUsed',
};

/** The analytics event names the recap aggregates over (for the DB query). */
export const RECAP_SOURCE_EVENTS: readonly string[] = Object.keys(RECAP_EVENT_FIELD);

export const EMPTY_COUNTS: RecapCounts = {
  sends: 0,
  risksFlagged: 0,
  claimsSent: 0,
  claimsReceived: 0,
  aiUsed: 0,
};

export function hasActivity(c: RecapCounts): boolean {
  return c.sends + c.risksFlagged + c.claimsSent + c.claimsReceived + c.aiUsed > 0;
}

/** Russian plural: pick form for 1 / 2-4 / 5+ (одна/две/пять). */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function enPlural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Build a safe recap body from factual counts. Returns null when there is no
 * activity (nothing to say → nothing sent). Text lists only non-zero clauses.
 */
export function buildRecapSummary(counts: RecapCounts, lang: Lang): string | null {
  if (!hasActivity(counts)) return null;
  const clauses: string[] = [];

  if (lang === 'en') {
    if (counts.sends) clauses.push(`${counts.sends} ${enPlural(counts.sends, 'transfer', 'transfers')} sent`);
    if (counts.claimsSent) clauses.push(`${counts.claimsSent} claim ${enPlural(counts.claimsSent, 'link', 'links')} created`);
    if (counts.claimsReceived) clauses.push(`${counts.claimsReceived} ${enPlural(counts.claimsReceived, 'link', 'links')} claimed`);
    if (counts.risksFlagged) clauses.push(`${counts.risksFlagged} risk ${enPlural(counts.risksFlagged, 'check', 'checks')} before signing`);
    if (counts.aiUsed) clauses.push(`${counts.aiUsed} Neura ${enPlural(counts.aiUsed, 'chat', 'chats')}`);
    return `This week: ${clauses.join(', ')}. Open your portfolio for details.`;
  }

  if (counts.sends) clauses.push(`${counts.sends} ${ruPlural(counts.sends, 'перевод', 'перевода', 'переводов')}`);
  if (counts.claimsSent) clauses.push(`${counts.claimsSent} claim-${ruPlural(counts.claimsSent, 'ссылка', 'ссылки', 'ссылок')}`);
  if (counts.claimsReceived) clauses.push(`${counts.claimsReceived} ${ruPlural(counts.claimsReceived, 'зачисление', 'зачисления', 'зачислений')} по ссылке`);
  if (counts.risksFlagged) clauses.push(`${counts.risksFlagged} риск-${ruPlural(counts.risksFlagged, 'проверка', 'проверки', 'проверок')} перед подписью`);
  if (counts.aiUsed) clauses.push(`${counts.aiUsed} ${ruPlural(counts.aiUsed, 'диалог', 'диалога', 'диалогов')} с Нейрой`);
  return `За неделю: ${clauses.join(', ')}. Открой портфель для деталей.`;
}

/**
 * ISO-week dedupe key ("weekly_recap:2026-W29"): guarantees at most one recap
 * per user per calendar week regardless of how often the trigger fires.
 */
export function isoWeekKey(nowMs: number): string {
  const d = new Date(nowMs);
  // ISO week: Thursday-anchored. Work in UTC to be deterministic in tests.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Sunday=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `weekly_recap:${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Feature flag. Off by default — recap endpoint inert, no recap dispatched. */
export function weeklyRecapEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WEEKLY_RECAP_ENABLED === 'true';
}

/** Trailing recap window (7 days) in ms. */
export const RECAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
