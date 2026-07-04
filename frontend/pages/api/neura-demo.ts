import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, getClientIp } from '@/lib/server/api-security';

/**
 * pages/api/neura-demo.ts
 * Public (no-JWT) Neura chat for DEMO mode — demo users have no Supabase
 * session, so the authed /api/neura-chat can't serve them.
 *
 * Kept deliberately protected (Phase 0 spirit: no unprotected AI endpoint):
 *   - strict per-IP rate limit (durable Upstash limiter),
 *   - hard max_tokens cap + short history window,
 *   - a locked demo prompt that NEVER receives or invents wallet data.
 * No walletContext is ever accepted or forwarded — the demo has no real
 * wallet, and Neura is instructed to redirect personal-data questions to
 * account creation instead of fabricating balances/prices/addresses.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';
const MAX_PER_MINUTE_PER_IP = 8;
const MAX_TOKENS = 300;

type Lang = 'ru' | 'en';

const DEMO_PROMPT_RU = `Ты — Нейра, дружелюбный AI-ассистент крипто-кошелька NeuroWallet. Сейчас идёт демо-режим: реального кошелька и реальных данных у пользователя пока нет.
Твоя задача — живо и тепло показать, чем ты полезна, и вовлечь человека.
Что ты умеешь (рассказывай об этом): подсказки по крипте (BTC, ETH, SOL, TRX, TON, USDT), помощь с переводами, объяснение транзакций и комиссий простыми словами, еженедельные сводки по портфелю, ответы на общие вопросы про кошелёк и безопасность.
Отвечай по-русски, по-доброму и по делу, обычно 2–4 предложения.
ВАЖНО — граница демо: у тебя НЕТ доступа к личным данным (баланс, транзакции, адреса, цены конкретного пользователя) — в демо их не существует. Если спрашивают про личные данные («мой баланс», «мои транзакции», «сколько у меня X») — НЕ выдумывай суммы, цены или адреса. Мягко объясни, что для персональных данных нужен настоящий кошелёк, и предложи создать кошелёк или войти в аккаунт.
Не давай индивидуальных инвестиционных советов (что конкретно покупать/продавать).`;

const DEMO_PROMPT_EN = `You are Neura, a friendly AI assistant in the NeuroWallet crypto wallet. This is demo mode: the user has no real wallet or real data yet.
Your job is to warmly and vividly show how you help, and get the person engaged.
What you can do (talk about this): crypto guidance (BTC, ETH, SOL, TRX, TON, USDT), help with transfers, explaining transactions and fees in plain language, weekly portfolio recaps, answering general questions about the wallet and security.
Reply in English, kindly and to the point, usually 2–4 sentences.
IMPORTANT — demo boundary: you have NO access to personal data (a specific user's balance, transactions, addresses, prices) — it doesn't exist in the demo. If asked about personal data ("my balance", "my transactions", "how much X do I have") — do NOT invent amounts, prices, or addresses. Gently explain that personal data needs a real wallet, and suggest creating a wallet or signing in.
Do not give individual investment advice (what specifically to buy/sell).`;

const ERRORS: Record<Lang, { rateLimited: string; noApiKey: string; noMessages: string; unavailable: string; noReply: string }> = {
  ru: {
    rateLimited: 'Слишком много запросов к Нейре. Попробуй через минуту.',
    noApiKey: 'AI временно не настроен на сервере (нет ключа).',
    noMessages: 'Нет сообщений.',
    unavailable: 'AI временно недоступен, попробуй чуть позже.',
    noReply: 'Не удалось получить ответ.',
  },
  en: {
    rateLimited: 'Too many requests to Neura. Try again in a minute.',
    noApiKey: 'AI is temporarily not configured on the server (missing key).',
    noMessages: 'No messages.',
    unavailable: 'AI is temporarily unavailable, try again later.',
    noReply: 'Could not get a reply.',
  },
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as { messages?: ChatMessage[]; lang?: Lang };
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru';
  const errors = ERRORS[lang];

  // Strict per-IP rate limit — the only gate for this unauthenticated path.
  const ip = getClientIp(req) ?? 'noip';
  if (!(await checkRateLimit(`neura-demo:${ip}`, MAX_PER_MINUTE_PER_IP))) {
    return res.status(429).json({ error: errors.rateLimited });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: errors.noApiKey });

  // Only user/assistant turns are forwarded — no wallet context, ever.
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (history.length === 0) return res.status(400).json({ error: errors.noMessages });

  const systemPrompt = lang === 'en' ? DEMO_PROMPT_EN : DEMO_PROMPT_RU;

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neurowallet.tech',
        'X-Title': 'NeuroWallet',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('neura-demo upstream error', upstream.status, errText.slice(0, 300));
      return res.status(200).json({ error: errors.unavailable });
    }

    const data = await upstream.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? errors.noReply;
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('neura-demo handler error', err);
    return res.status(200).json({ error: errors.unavailable });
  }
}
