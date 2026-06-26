/**
 * pages/api/tg-notify.ts
 * Sends a Telegram message to a user via the bot.
 * Called server-side after a successful transaction.
 *
 * Body: { telegramId: number, message: string }
 * TELEGRAM_BOT_TOKEN is server-only — never NEXT_PUBLIC_.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

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

  if (!checkRateLimit(`tg-notify:${auth.user.id}`, 10)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  const { telegramId, message } = req.body as { telegramId?: number; message?: string };
  if (!telegramId || !message) {
    return res.status(400).json({ error: 'telegramId and message required' });
  }

  const userTelegramId = auth.user.user_metadata?.telegram_id;
  if (!userTelegramId || Number(userTelegramId) !== Number(telegramId)) {
    return res.status(403).json({ error: 'Telegram recipient mismatch' });
  }

  try {
    await writeAuditLog(
      auth.user.id,
      'telegram_notification_requested',
      { telegram_id: telegramId, message_chars: message.length },
      req,
    );

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    telegramId,
        text:       message,
        parse_mode: 'HTML',
      }),
    });

    if (!tgRes.ok) {
      const err = await tgRes.text();
      console.error('[tg-notify] Telegram API error:', err);
      return res.status(500).json({ error: 'Failed to send notification' });
    }

    await writeAuditLog(auth.user.id, 'telegram_notification_sent', { telegram_id: telegramId }, req);
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
