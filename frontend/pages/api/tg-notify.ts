/**
 * pages/api/tg-notify.ts
 * Template-only Telegram notification about the caller's own sent transaction.
 *
 * Body: { kind: 'tx_sent', coin, amount, to, hash, lang?: 'ru'|'en' }
 *   coin   ∈ ETH | USDT | BTC | SOL | TRX | TRC20 | TON | USDT_TON
 *   amount   decimal string, /^\d{1,18}(\.\d{1,18})?$/
 *   to, hash ≤128 chars of [A-Za-z0-9:_\-.]
 * The server composes the text (lib/server/tg-notify-template.ts) and
 * HTML-escapes every value. Free text is never forwarded: the old
 * { message } contract let any caller send arbitrary HTML from the official
 * bot, so it now gets 400.
 *
 * The recipient is app_metadata.telegram_id of the session (written only by
 * /api/tg-auth with the service role after the initData HMAC check). Body
 * fields such as telegramId and user_metadata are ignored.
 * TELEGRAM_BOT_TOKEN is server-only, never NEXT_PUBLIC_.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { getVerifiedTelegramId } from '@/lib/server/telegram-id';
import { composeTxSentMessage, parseTxSentNotice } from '@/lib/server/tg-notify-template';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await checkRateLimit(`tg-notify:${auth.user.id}`, 10))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  const parsed = parseTxSentNotice(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const notice = parsed.value;

  // Recipient comes exclusively from service-role app_metadata.
  const telegramId = getVerifiedTelegramId(auth.user);
  if (!telegramId) {
    return res.status(403).json({ error: 'No Telegram account linked' });
  }

  const text = composeTxSentMessage(notice);

  try {
    // No `to` / `hash` in the audit row: coin + size are enough to trace abuse.
    await writeAuditLog(
      auth.user.id,
      'telegram_notification_requested',
      { telegram_id: telegramId, kind: notice.kind, coin: notice.coin, message_chars: text.length },
      req,
    );

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    telegramId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!tgRes.ok) {
      const err = await tgRes.text();
      console.error('[tg-notify] Telegram API error:', err.slice(0, 300));
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    await writeAuditLog(auth.user.id, 'telegram_notification_sent', { telegram_id: telegramId, kind: notice.kind }, req);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[tg-notify] error:', err);
    await writeAuditLog(
      auth.user.id,
      'telegram_notification_failed',
      { telegram_id: telegramId, error: err instanceof Error ? err.message : String(err) },
      req,
    );
    return res.status(500).json({ error: 'Internal error' });
  }
}
