/**
 * pages/api/neura-explain.ts — structured AI v1 (задача 1.7).
 *
 * Отличие от neura-chat: НИКАКОГО свободного пользовательского ввода.
 * Клиент присылает факты; сервер прогоняет их через СТРОГУЮ схему
 * (неизвестные ключи отбрасываются, неверные типы = 400), строит промпт
 * сам и просит LLM только оформить текст из фактов. Всё, чего нет в
 * фактах, модель просят не упоминать; полные адреса сюда не попадают
 * by construction (клиент шлёт усечённый counterparty).
 *
 * Audit: ai_explain_requested { kind, facts_hash } и
 * ai_explain_completed { reply_hash } — hash = sha256 (приёмка плана).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';
const CHAINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);

type Lang = 'ru' | 'en';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Строгая валидация фактов: возвращает канонический объект или null. */
export function validateFacts(raw: unknown): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === 'tx') {
    if (typeof r.chain !== 'string' || !CHAINS.has(r.chain)) return null;
    if (r.direction !== 'in' && r.direction !== 'out') return null;
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount)) return null;
    if (typeof r.counterparty !== 'string' || r.counterparty.length > 20) return null; // только усечённый вид
    if (typeof r.date !== 'string' || r.date.length > 32) return null;
    const fee = typeof r.fee === 'number' && Number.isFinite(r.fee) ? r.fee : 'unknown';
    return { kind: 'tx', chain: r.chain, direction: r.direction, amount: r.amount, counterparty: r.counterparty.slice(0, 20), date: r.date, fee };
  }

  if (r.kind === 'recap') {
    if (typeof r.totalEur !== 'number' || !Number.isFinite(r.totalEur)) return null;
    if (!Array.isArray(r.coins) || r.coins.length === 0 || r.coins.length > 10) return null;
    const coins = [];
    for (const c of r.coins as Array<Record<string, unknown>>) {
      if (typeof c?.coin !== 'string' || !CHAINS.has(c.coin)) return null;
      if (typeof c.balance !== 'number' || !Number.isFinite(c.balance)) return null;
      if (typeof c.eur !== 'number' || !Number.isFinite(c.eur)) return null;
      const change = typeof c.change24h === 'number' && Number.isFinite(c.change24h) ? c.change24h : 'unknown';
      coins.push({ coin: c.coin, balance: c.balance, eur: c.eur, change24h: change });
    }
    return { kind: 'recap', totalEur: r.totalEur, coins };
  }

  return null;
}

function buildPrompt(facts: Record<string, unknown>, lang: Lang): string {
  const head =
    lang === 'en'
      ? 'You are Neura, the assistant inside NeuroWallet. Below are VERIFIED facts as JSON. Write a short, friendly explanation (2–3 sentences) STRICTLY from these facts. Do not add, guess or extrapolate anything not present in the facts. If a value is "unknown", say it is unknown. No investment advice.'
      : 'Ты — Нейра, ассистент внутри NeuroWallet. Ниже ПРОВЕРЕННЫЕ факты в JSON. Составь короткое дружелюбное объяснение (2–3 предложения) СТРОГО из этих фактов. Ничего не добавляй, не угадывай и не экстраполируй. Если значение "unknown" — так и скажи, что оно неизвестно. Без инвестиционных советов.';
  return `${head}\n\nFACTS:\n${JSON.stringify(facts)}`;
}

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

  if (!(await checkRateLimit(`neura-explain:${auth.user.id}`, 15))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const body = req.body as { facts?: unknown; lang?: string };
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru';
  const facts = validateFacts(body.facts);
  if (!facts) return res.status(400).json({ error: 'Invalid facts' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI not configured' });

  const factsJson = JSON.stringify(facts);
  await writeAuditLog(auth.user.id, 'ai_explain_requested', { kind: facts.kind, facts_hash: sha256(factsJson) }, req);

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
        messages: [{ role: 'system', content: buildPrompt(facts, lang) }],
        max_tokens: 220,
        temperature: 0.4,
      }),
    });

    if (!upstream.ok) {
      return res.status(200).json({ error: lang === 'en' ? 'AI is temporarily unavailable.' : 'AI временно недоступен.' });
    }

    const data = await upstream.json();
    const reply: string = data?.choices?.[0]?.message?.content ?? '';
    if (!reply) return res.status(200).json({ error: lang === 'en' ? 'No reply.' : 'Не удалось получить ответ.' });

    await writeAuditLog(auth.user.id, 'ai_explain_completed', { kind: facts.kind, reply_hash: sha256(reply) }, req);
    return res.status(200).json({ reply });
  } catch {
    await writeAuditLog(auth.user.id, 'ai_explain_failed', { kind: facts.kind }, req);
    return res.status(200).json({ error: lang === 'en' ? 'AI is temporarily unavailable.' : 'AI временно недоступен.' });
  }
}
