import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

/**
 * pages/api/neura-chat.ts
 * Server-side proxy to OpenRouter (OpenAI-compatible LLM API).
 * The secret key (OPENROUTER_API_KEY) lives only in server env vars —
 * it is never exposed to the browser.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

type Lang = 'ru' | 'en';

const SYSTEM_PROMPT_RU = `Ты — Нейра, AI-финансовый советник внутри крипто-кошелька NeuroWallet.
Отвечай по-русски, дружелюбно и по делу, без лишней воды.
Ты помогаешь пользователю разбираться в его крипто-портфеле (BTC, ETH, SOL, TRX, USDT), тратах и финансовых решениях.
Если не знаешь точных актуальных цифр пользователя (баланс, цены) — не выдумывай конкретные суммы, а отвечай по существу вопроса и предложи, где это посмотреть в приложении (экран «Активы»).
Будь краткой: 2-4 предложения, если не просят подробный разбор.`;

const SYSTEM_PROMPT_EN = `You are Neura, an AI financial advisor inside the NeuroWallet crypto wallet.
Reply in English, in a friendly and to-the-point way, without unnecessary filler.
You help the user understand their crypto portfolio (BTC, ETH, SOL, TRX, USDT), spending, and financial decisions.
If you don't know the user's exact current numbers (balance, prices) — don't make up specific amounts; answer the substance of the question and suggest where to check it in the app (the "Assets" screen).
Be concise: 2-4 sentences unless a detailed breakdown is requested.`;

const ERRORS: Record<Lang, {
  authRequired: string;
  rateLimited: string;
  noApiKey: string;
  noMessages: string;
  outOfBalance: string;
  unavailable: string;
  noReply: string;
}> = {
  ru: {
    authRequired: 'Требуется вход в аккаунт.',
    rateLimited: 'Слишком много запросов к AI. Попробуй через минуту.',
    noApiKey: 'AI временно не настроен на сервере (нет ключа).',
    noMessages: 'Нет сообщений.',
    outOfBalance: 'AI временно недоступен — на аккаунте OpenRouter закончился баланс.',
    unavailable: 'AI временно недоступен, попробуй чуть позже.',
    noReply: 'Не удалось получить ответ.',
  },
  en: {
    authRequired: 'You need to sign in.',
    rateLimited: 'Too many AI requests. Try again in a minute.',
    noApiKey: 'AI is temporarily not configured on the server (missing key).',
    noMessages: 'No messages.',
    outOfBalance: 'AI is temporarily unavailable — the OpenRouter account ran out of balance.',
    unavailable: 'AI is temporarily unavailable, try again later.',
    noReply: 'Could not get a reply.',
  },
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface WalletContext {
  eth?: number; btc?: number; sol?: number; trx?: number; ton?: number; usdt?: number; usdtTrc?: number; usdtTon?: number;
  ethEur?: number; btcEur?: number; solEur?: number; trxEur?: number; tonEur?: number;
  ethAddr?: string; btcAddr?: string; solAddr?: string; tronAddr?: string; tonAddr?: string;
}

function buildSystemPrompt(lang: Lang, ctx?: WalletContext): string {
  let prompt = lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_RU;
  if (ctx && (ctx.eth !== undefined || ctx.btc !== undefined)) {
    const lines: string[] = [lang === 'en' ? "\n\nUser's current wallet data:" : '\n\nТекущие данные кошелька пользователя:'];
    if (ctx.btc  !== undefined) lines.push(`• BTC: ${ctx.btc.toFixed(6)} BTC (~€${((ctx.btc || 0) * (ctx.btcEur || 0)).toFixed(2)})`);
    if (ctx.eth  !== undefined) lines.push(`• ETH: ${ctx.eth.toFixed(4)} ETH (~€${((ctx.eth || 0) * (ctx.ethEur || 0)).toFixed(2)})`);
    if (ctx.sol  !== undefined) lines.push(`• SOL: ${ctx.sol.toFixed(4)} SOL (~€${((ctx.sol || 0) * (ctx.solEur || 0)).toFixed(2)})`);
    if (ctx.trx  !== undefined) lines.push(`• TRX: ${ctx.trx.toFixed(4)} TRX (~€${((ctx.trx || 0) * (ctx.trxEur || 0)).toFixed(2)})`);
    if (ctx.usdt    !== undefined) lines.push(`• USDT (ERC-20): ${ctx.usdt.toFixed(2)} USDT`);
    if (ctx.usdtTrc !== undefined) lines.push(`• USDT (TRC-20): ${ctx.usdtTrc.toFixed(2)} USDT`);
    if (ctx.ton !== undefined) lines.push(`• TON: ${ctx.ton.toFixed(4)} TON (~€${((ctx.ton || 0) * (ctx.tonEur || 0)).toFixed(2)})`);
    if (ctx.usdtTon !== undefined) lines.push(`• USDT TON: ${ctx.usdtTon.toFixed(2)} USDT`);
    if (ctx.ethAddr)  lines.push(`• ${lang === 'en' ? 'ETH/USDT address' : 'ETH/USDT адрес'}: ${ctx.ethAddr}`);
    if (ctx.btcAddr)  lines.push(`• ${lang === 'en' ? 'BTC address' : 'BTC адрес'}: ${ctx.btcAddr}`);
    if (ctx.solAddr)  lines.push(`• ${lang === 'en' ? 'SOL address' : 'SOL адрес'}: ${ctx.solAddr}`);
    if (ctx.tronAddr) lines.push(`• ${lang === 'en' ? 'Tron address' : 'Tron адрес'}: ${ctx.tronAddr}`);
    if (ctx.tonAddr)  lines.push(`• ${lang === 'en' ? 'TON address' : 'TON адрес'}: ${ctx.tonAddr}`);
    lines.push(lang === 'en'
      ? 'Use this data to give concrete advice about the user’s portfolio.'
      : 'Используй эти данные, чтобы давать конкретные советы по портфелю пользователя.');
    prompt += lines.join('\n');
  }
  return prompt;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as { messages?: ChatMessage[]; walletContext?: WalletContext; lang?: Lang };
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru';
  const errors = ERRORS[lang];

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: errors.authRequired });
  }

  if (!(await checkRateLimit(`neura-chat:${auth.user.id}`, 20))) {
    return res.status(429).json({ error: errors.rateLimited });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: errors.noApiKey });
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const systemPrompt = buildSystemPrompt(lang, body.walletContext);

  if (history.length === 0) {
    return res.status(400).json({ error: errors.noMessages });
  }

  try {
    await writeAuditLog(
      auth.user.id,
      'ai_chat_requested',
      { message_count: history.length, has_wallet_context: Boolean(body.walletContext) },
      req,
    );

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
          ? errors.outOfBalance
          : errors.unavailable;
      return res.status(200).json({ error: friendly });
    }

    const data = await upstream.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? errors.noReply;
    await writeAuditLog(auth.user.id, 'ai_chat_completed', { reply_chars: reply.length }, req);
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('neura-chat handler error', err);
    await writeAuditLog(auth.user.id, 'ai_chat_failed', { error: err instanceof Error ? err.message : String(err) }, req);
    return res.status(200).json({ error: errors.unavailable });
  }
}
