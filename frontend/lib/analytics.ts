/**
 * lib/analytics.ts — клиентский трекинг (Фаза 1.1).
 *
 * Принципы:
 *  - fire-and-forget: аналитика никогда не ломает и не тормозит основной флоу;
 *  - никаких PII в properties (сервер дополнительно фильтрует по allowlist);
 *  - session_id — эфемерный uuid вкладки (sessionStorage), позволяет склеить
 *    анонимные pre-auth события с пользователем после логина
 *    (событие session_identified);
 *  - trace_id — сквозной uuid одного флоу (send, chat): передаётся заголовком
 *    x-trace-id и попадает и в analytics_events, и в audit_log.metadata.
 */

import { supabase } from './supabase';

const SESSION_KEY = 'nw_analytics_session';

export function newTraceId(): string {
  return crypto.randomUUID();
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return '00000000-0000-0000-0000-000000000000';
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** Имена должны совпадать с серверным allowlist в pages/api/track.ts. */
export type AnalyticsEvent =
  | 'onboarding_started'
  | 'wallet_created'
  | 'wallet_imported'
  | 'onboarding_completed'
  | 'send_initiated'
  | 'send_succeeded'
  | 'send_failed'
  | 'send_review_shown'
  | 'send_review_blocked'
  | 'risk_flagged'
  | 'risk_override'
  | 'first_send_succeeded'
  | 'ai_chat_used'
  | 'ai_explain_used'
  | 'demo_entered'
  | 'demo_task_completed'
  | 'demo_funnel_completed'
  | 'demo_convert_clicked'
  | 'session_identified'
  | 'sessions_revoked';

export function track(
  event: AnalyticsEvent,
  properties?: Record<string, string | number | boolean>,
  traceId?: string,
): void {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (traceId) headers['x-trace-id'] = traceId;
      await fetch('/api/track', {
        method: 'POST',
        headers,
        keepalive: true,
        body: JSON.stringify({ event, properties, session_id: getSessionId() }),
      });
    } catch {
      /* никогда не пробрасываем ошибки аналитики */
    }
  })();
}

/** Однократное событие на вкладку (например, first_send определяется по localStorage). */
export function trackOnce(storageKey: string, event: AnalyticsEvent, properties?: Record<string, string | number | boolean>, traceId?: string): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(storageKey)) return;
  localStorage.setItem(storageKey, '1');
  track(event, properties, traceId);
}
