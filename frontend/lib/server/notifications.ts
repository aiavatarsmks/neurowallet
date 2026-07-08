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
export type NotificationKind = 'tx_sent' | 'security_alert' | 'weekly_recap';

type Composed = { title: string; body: string };
type Template = (m: Record<string, string>) => Composed;

const TEMPLATES: Record<NotificationKind, Record<Lang, Template>> = {
  tx_sent: {
    ru: (m) => ({ title: 'Перевод отправлен', body: `${m.coin ?? 'Крипто'} отправлено. Статус — в истории.` }),
    en: (m) => ({ title: 'Transfer sent', body: `${m.coin ?? 'Crypto'} sent. Track the status in history.` }),
  },
  security_alert: {
    ru: () => ({ title: 'Событие безопасности', body: 'Проверь центр безопасности в профиле.' }),
    en: () => ({ title: 'Security event', body: 'Review the security center in your profile.' }),
  },
  weekly_recap: {
    ru: (m) => ({ title: 'Итоги недели', body: m.summary ?? 'Твоя недельная сводка готова.' }),
    en: (m) => ({ title: 'Weekly recap', body: m.summary ?? 'Your weekly recap is ready.' }),
  },
};

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
): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return;

  const tpl = TEMPLATES[kind]?.[lang] ?? TEMPLATES[kind]?.ru;
  if (!tpl) return;
  const { title, body } = tpl(meta);

  try {
    const supabase = createClient(url, serviceKey);
    await supabase.from('notifications').insert({
      user_id: userId,
      kind,
      title,
      body,
      meta: Object.keys(meta).length ? meta : null,
      dedupe_key: dedupeKey ?? null,
    });
  } catch (err) {
    // dedupe conflict or transient error — inbox is best-effort.
    console.warn('[notifications] skipped:', err instanceof Error ? err.message : err);
  }
}
