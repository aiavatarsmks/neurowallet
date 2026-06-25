import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * pages/api/neura-chat.ts
 * Server-side proxy to OpenRouter (OpenAI-compatible LLM API).
 * The secret key (OPENROUTER_API_KEY) lives only in server env vars —
 * it is never exposed to the browser.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

const SYSTEM_PROMPT = `Ты — Нейра, AI-финансовый советник внутри крипто-кошелька NeuroWallet.
Отвечай по-русски, дружелюбно и по делу, без лишней воды.
Ты помогаешь пользователю разбираться в его крипто-портфеле (BTC, ETH, SOL, USDT), тратах и финансовых решениях.
Если не знаешь точных актуальных цифр пользователя (баланс, цены) — не выдумывай конкретные суммы, а отвечай по существу вопроса и предложи, где это посмотреть в приложении (экран «Активы»).
Будь краткой: 2-4 предложения, если не просят подробный разбор.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface WalletContext {
  eth?: number; btc?: number; sol?: number; usdt?: number; usdtTrc?: number;
  ethEur?: number; btcEur?: number; solEur?: number;
  ethAddr?: string; btcAddr?: string; solAddr?: string; tronAddr?: string;
}

function buildSystemPrompt(ctx?: WalletContext): string {
  let prompt = SYSTEM_PROMPT;
  if (ctx && (ctx.eth !== undefined || ctx.btc !== undefined)) {
    const lines: string[] = ['\n\nТекущие данные кошелька пользователя:'];
    if (ctx.btc  !== undefined) lines.push(`• BTC: ${ctx.btc.toFixed(6)} BTC (~€${((ctx.btc || 0) * (ctx.btcEur || 0)).toFixed(2)})`);
    if (ctx.eth  !== undefined) lines.push(`• ETH: ${ctx.eth.toFixed(4)} ETH (~€${((ctx.eth || 0) * (ctx.ethEur || 0)).toFixed(2)})`);
    if (ctx.sol  !== undefined) lines.push(`• SOL: ${ctx.sol.toFixed(4)} SOL (~€${((ctx.sol || 0) * (ctx.solEur || 0)).toFixed(2)})`);
    if (ctx.usdt    !== undefined) lines.push(`• USDT (ERC-20): ${ctx.usdt.toFixed(2)} USDT`);
    if (ctx.usdtTrc !== undefined) lines.push(`• USDT (TRC-20): ${ctx.usdtTrc.toFixed(2)} USDT`);
    if (ctx.ethAddr)  lines.push(`• ETH/USDT адрес: ${ctx.ethAddr}`);
    if (ctx.btcAddr)  lines.push(`• BTC адрес: ${ctx.btcAddr}`);
    if (ctx.solAddr)  lines.push(`• SOL адрес: ${ctx.solAddr}`);
    if (ctx.tronAddr) lines.push(`• Tron адрес: ${ctx.tronAddr}`);
    lines.push('Используй эти данные, чтобы давать конкретные советы по портфелю пользователя.');
    prompt += lines.join('\n');
  }
  return prompt;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI временно не настроен на сервере (нет ключа).' });
  }

  const body = req.body as { messages?: ChatMessage[]; walletContext?: WalletContext };
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const systemPrompt = buildSystemPrompt(body.walletContext);

  if (history.length === 0) {
    return res.status(400).json({ error: 'Нет сообщений.' });
  }

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
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Gonka API error', upstream.status, errText.slice(0, 500));
      const friendly =
        upstream.status === 402 || upstream.status === 429
          ? 'AI временно недоступен — на аккаунте OpenRouter закончился баланс.'
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
