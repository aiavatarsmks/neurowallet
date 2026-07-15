import { createClient } from '@supabase/supabase-js';

/**
 * lib/server/notifications.ts — server-side inbox writes (Фаза 2.4).
 *
 * The client never sends notification TEXT: it only names an allowlisted kind
 * (+ a validated coin), and the server composes the title/body from templates
 * here. No amounts or full addresses ever go into a notification (inv.:
 * никаких чувствительных данных в текстах). Insert is service-role only (RLS
 * denies client writes). Telegram delivery is intentionally NOT here — that
 * needs an explicit decision (не писать тестерам без разрешения).
 */

export type Lang = 'ru' | 'en';
export type { NotificationKind } from '../notifications-config';
import type { NotificationKind } from '../notifications-config';

type Composed = { title: string; body: string };
type Template = (m: Record<string, string>) => Composed;

/**
 * Allowlist templates. The client never sends text — it names a kind (+ a
 * validated coin), the server composes the copy here. NO amounts, full
 * addresses, or secrets ever appear: only the safe minimum (coin symbol, a
 * "check history/security center" nudge). The same text is reused verbatim for
 * the Telegram channel, so this is the single anti-leak chokepoint.
 */
const TEMPLATES: Record<NotificationKind, Record<Lang, Template>> = {
  tx_sent: {
    ru: (m) => ({ title: 'Перевод отправлен', body: `${m.coin ?? 'Крипто'} отправлено. Статус — в истории.` }),
    en: (m) => ({ title: 'Transfer sent', body: `${m.coin ?? 'Crypto'} sent. Track the status in history.` }),
  },
  tx_failed: {
    ru: (m) => ({ title: 'Перевод не прошёл', body: `Отправка ${m.coin ?? 'крипто'} не удалась. Открой историю для деталей.` }),
    en: (m) => ({ title: 'Transfer failed', body: `Sending ${m.coin ?? 'crypto'} did not go through. Open history for details.` }),
  },
  claim_received: {
    ru: (m) => ({ title: 'Твою ссылку забрали', body: `Получатель забрал ${m.coin ?? 'перевод'} по твоей claim-ссылке.` }),
    en: (m) => ({ title: 'Your link was claimed', body: `The recipient claimed your ${m.coin ?? 'transfer'} link.` }),
  },
  security_alert: {
    ru: () => ({ title: 'Событие безопасности', body: 'Проверь центр безопасности в профиле.' }),
    en: () => ({ title: 'Security event', body: 'Review the security center in your profile.' }),
  },
  price_alert: {
    ru: (m) => ({ title: 'Ценовое уведомление', body: `Заметное движение цены ${m.coin ?? 'актива'}. Открой портфель.` }),
    en: (m) => ({ title: 'Price alert', body: `Notable price move for ${m.coin ?? 'an asset'}. Open your portfolio.` }),
  },
  weekly_recap: {
    ru: (m) => ({ title: 'Итоги недели', body: m.summary ?? 'Твоя недельная сводка готова.' }),
    en: (m) => ({ title: 'Weekly recap', body: m.summary ?? 'Your weekly recap is ready.' }),
  },
};

/** Compose safe title/body for a kind (used by both inbox and Telegram channels). */
export function composeNotification(
  kind: NotificationKind,
  lang: Lang,
  meta: Record<string, string> = {},
): Composed | null {
  const tpl = TEMPLATES[kind]?.[lang] ?? TEMPLATES[kind]?.ru;
  return tpl ? tpl(meta) : null;
}

/**
 * Insert one inbox notification (service role). Dedupe: if dedupeKey is given
 * and already used for this user, the insert is a no-op (unique index). Never
 * throws — inbox writes must not break the caller.
 */
export async function writeNotification(
  userId: string,
  kind: NotificationKind,
  lang: Lang,
  meta: Record<string, string> = {},
  dedupeKey?: string,
): Promise<'inserted' | 'skipped'> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return 'skipped';

  const composed = composeNotification(kind, lang, meta);
  if (!composed) return 'skipped';

  try {
    const supabase = createClient(url, serviceKey);
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      kind,
      title: composed.title,
      body: composed.body,
      meta: Object.keys(meta).length ? meta : null,
      dedupe_key: dedupeKey ?? null,
    });
    // Unique dedupe index → duplicate is a no-op (already delivered).
    if (error) return 'skipped';
    return 'inserted';
  } catch (err) {
    // transient error — inbox is best-effort.
    console.warn('[notifications] skipped:', err instanceof Error ? err.message : err);
    return 'skipped';
  }
}
