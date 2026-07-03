/**
 * lib/neura/explain-client.ts — клиентский вызов structured-объяснений (1.7).
 * Отправляет ТОЛЬКО собранные факты (lib/neura/facts.ts) — никакого
 * свободного текста и никаких полных адресов.
 */

import { supabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';
import type { NeuraFacts } from './facts';

export async function fetchExplanation(facts: NeuraFacts, lang: 'ru' | 'en'): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    track('ai_explain_used', { kind: facts.kind });
    const r = await fetch('/api/neura-explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ facts, lang }),
    });
    const body = await r.json().catch(() => null);
    return typeof body?.reply === 'string' ? body.reply : null;
  } catch {
    return null;
  }
}
