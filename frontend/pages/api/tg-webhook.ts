/**
 * pages/api/tg-webhook.ts
 * Telegram Bot webhook — handles /start, /help and the "Как это работает"
 * callback button. Sends the welcome message (sales/"продающий" copy,
 * see NeuroWallet_Welcome_Final.docx) with an inline keyboard that opens
 * the Mini App.
 *
 * Setup (one-time, after deploy):
 *   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
 *     -d "url=https://neurowallet-frontend.vercel.app/api/tg-webhook" \
 *     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 *   NOTE: the custom domain neurovalet.tech currently does not resolve
 *   (DNS_PROBE_FINISHED_NXDOMAIN as of 2026-07-02 — IONOS DNS not pointing
 *   at Vercel correctly). Use the working neurowallet-frontend.vercel.app
 *   URL until DNS is fixed, then switch both this webhook URL and
 *   NEXT_PUBLIC_APP_URL back to https://neurovalet.tech.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN      — server-only, already used by tg-auth / tg-notify
 *   TELEGRAM_WEBHOOK_SECRET — server-only, optional but recommended. If set,
 *                             Telegram must echo it back in the
 *                             X-Telegram-Bot-Api-Secret-Token header on every
 *                             webhook call (Telegram sets this automatically
 *                             once secret_token is passed to setWebhook).
 *   NEXT_PUBLIC_APP_URL     — Mini App URL. Falls back to
 *                             https://neurowallet-frontend.vercel.app
 *
 * Security notes:
 *   - This endpoint is public (Telegram calls it, not a logged-in user), so it
 *     cannot use requireSupabaseUser. It is protected instead by the webhook
 *     secret token check below, plus a per-chat rate limit.
 *   - No private keys, wallet, or AI logic are touched here — this only sends
 *     static onboarding copy and opens the Mini App URL.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit } from '@/lib/server/api-security';

const MINI_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://neurowallet-frontend.vercel.app';

// ─── Copy (продающий / sales variant — see NeuroWallet_Welcome_Final.docx) ────

const WELCOME_TEXT = `🚀 <b>Крипта без лишней сложности</b>

NeuroWallet — это кошелёк, где <b>Нейра</b> помогает
быстро отправлять, получать и контролировать активы.

<b>Поддержка: BTC, ETH, SOL, USDT (ERC-20, TRC-20)</b>
Один клик на отправку и получение.
Прозрачная история транзакций.
Ключи — под твоим контролем.

Открой NeuroWallet и управляй криптой быстрее и спокойнее ↓`;

const HOW_IT_WORKS_TEXT = `<b>Как это работает</b>

1. Открываешь кошелёк — ключи создаются или импортируются прямо на твоём устройстве.
2. Нейра подсказывает и помогает разобраться, что происходит на каждом шаге.
3. Отправляешь и получаешь BTC, ETH, SOL, USDT (ERC-20, TRC-20) в один клик — ключи всегда остаются у тебя.`;

const HELP_TEXT = `Не получилось открыть кошелёк?

Нажми кнопку ещё раз
или используй /help.

Если проблема повторяется,
открой бот через меню и запусти приложение оттуда.`;

// ─── Telegram API helper ───────────────────────────────────────────────────

async function tgCall(botToken: string, method: string, body: object) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[tg-webhook] ${method} failed:`, await res.text());
  }
  return res;
}

function sendWelcome(botToken: string, chatId: number) {
  return tgCall(botToken, 'sendMessage', {
    chat_id: chatId,
    text: WELCOME_TEXT,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Перейти в кошелёк', web_app: { url: MINI_APP_URL } }],
        [{ text: 'Как это работает', callback_data: 'how_it_works' }],
      ],
    },
  });
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('[tg-webhook] TELEGRAM_BOT_TOKEN not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Deny by default: the webhook secret is mandatory. If the env var is
  // missing the endpoint refuses to serve rather than accepting anyone.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[tg-webhook] TELEGRAM_WEBHOOK_SECRET not set — refusing request');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  if (incoming !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // IMPORTANT: do the Telegram send(s) BEFORE responding to this webhook call.
  // Vercel's serverless runtime can freeze the function right after the HTTP
  // response is flushed, which would silently kill any "fire and forget"
  // work started after res.json(). Telegram allows several seconds for a
  // webhook response, so awaiting first is safe and reliable.
  try {
    const update = req.body as {
      message?: { chat: { id: number }; text?: string };
      callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
    };

    const message = update?.message;
    if (message?.text) {
      const chatId = message.chat.id;
      if (checkRateLimit(`tg-webhook:${chatId}`, 20)) {
        const text = message.text.trim();
        if (text === '/start') {
          await sendWelcome(botToken, chatId);
        } else if (text === '/help') {
          await tgCall(botToken, 'sendMessage', { chat_id: chatId, text: HELP_TEXT });
        }
      }
    } else {
      const callback = update?.callback_query;
      if (callback?.data === 'how_it_works' && callback.message) {
        const chatId = callback.message.chat.id;
        if (checkRateLimit(`tg-webhook:${chatId}`, 20)) {
          await tgCall(botToken, 'answerCallbackQuery', { callback_query_id: callback.id });
          await tgCall(botToken, 'sendMessage', {
            chat_id: chatId,
            text: HOW_IT_WORKS_TEXT,
            parse_mode: 'HTML',
          });
        }
      }
    }
  } catch (err) {
    console.error('[tg-webhook] error:', err);
  }

  return res.status(200).json({ ok: true });
}
