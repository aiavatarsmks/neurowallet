import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * pages/api/neura-chat.ts
 * Server-side proxy to Gonka Broker (OpenAI-compatible LLM API).
 * The secret key (GONKA_API_KEY) lives only in server env vars —
 * it is never exposed to the browser.
 */

const GONKA_URL = 'https://proxy.gonkabroker.com/v1/chat/completions';
const MODEL = 'Qwen/Qwen3-235B-A22B-Instruct-2507-FP8';

const SYSTEM_PROMPT = `Ты — Нейра, AI-финансовый советник внутри крипто-кошелька NeuroWallet.
Отвечай по-русски, дружелюбно и по делу, без лишней воды.
Ты помогаешь пользователю разбираться в его крипто-портфеле (BTC, ETH, SOL, USDT), тратах и финансовых решениях.
Если не знаешь точных актуальных цифр пользователя (баланс, цены) — не выдумывай конкретные суммы, а отвечай по существу вопроса и предложи, где это посмотреть в приложении (экран «Активы»).
Будь краткой: 2-4 предложения, если не просят подробный разбор.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GONKA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI временно не настроен на сервере (нет ключа).' });
  }

  const body = req.body as { messages?: ChatMessage[] };
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

  if (history.length === 0) {
    return res.status(400).json({ error: 'Нет сообщений.' });
  }

  try {
    const upstream = await fetch(GONKA_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Gonka API error', upstream.status, errText.slice(0, 500));
      const friendly =
        upstream.status === 402 || upstream.status === 403
          ? 'AI временно недоступен — на аккаунте Gonka Broker закончился баланс. Нужно сделать Top Up.'
          : 'AI временно недоступен, попробуй чуть позже.';
      return res.status(200).json({ error: friendly });
    }

    const data = await upstream.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? 'Не удалось получить ответ.';
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('neura-chat handler error', err);
    return res.status(200).json({ error: 'AI временно недоступен, попробуй чуть позже.' });
  }
}
