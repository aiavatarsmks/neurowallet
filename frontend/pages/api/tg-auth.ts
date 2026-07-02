/**
 * pages/api/tg-auth.ts
 * Telegram Mini App authentication endpoint.
 *
 * Flow:
 *   1. Client sends initData string from window.Telegram.WebApp.initData
 *   2. Server validates HMAC-SHA256 using TELEGRAM_BOT_TOKEN
 *   3. Derives a deterministic Supabase email+password for the Telegram user
 *   4. Creates or signs in the Supabase account
 *   5. Returns the Supabase session (access_token, refresh_token)
 *
 * Security notes:
 *   - TELEGRAM_BOT_TOKEN is server-only — never NEXT_PUBLIC_
 *   - The derived password is HMAC(telegram_id, bot_token) — deterministic but secret
 *   - initData is validated within 24 h (auth_date check)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit, writeAuditLog } from '@/lib/server/api-security';

// ─── HMAC validation ──────────────────────────────────────────────────────────

function validateTelegramInitData(initData: string, botToken: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) return null;

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // Key derivation: HMAC-SHA256("WebAppData", botToken)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  try {
    if (!timingSafeEqual(Buffer.from(receivedHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
      return null;
    }
  } catch {
    return null;
  }

  // Check auth_date is within 24 hours
  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  if (Date.now() / 1000 - authDate > 86400) return null;

  return Object.fromEntries(params.entries());
}

// ─── Derive deterministic Supabase credentials ────────────────────────────────

function deriveCredentials(telegramId: number, botToken: string) {
  const email    = `tg_${telegramId}@neurowallet.tg`;
  const password = createHmac('sha256', botToken)
    .update(`neurowallet_tg_${telegramId}`)
    .digest('hex')
    .slice(0, 32);
  return { email, password };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Login endpoint — no JWT exists yet, so throttle by client IP.
  const clientIp =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : null) ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkRateLimit(`tg-auth:${clientIp}`, 10)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('[tg-auth] TELEGRAM_BOT_TOKEN not set');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { initData } = req.body as { initData?: string };
  if (!initData || typeof initData !== 'string') {
    return res.status(400).json({ error: 'initData required' });
  }

  // 1. Validate HMAC
  const validatedData = validateTelegramInitData(initData, botToken);
  if (!validatedData) {
    return res.status(401).json({ error: 'Invalid or expired initData' });
  }

  // 2. Parse user info
  let tgUser: { id: number; first_name: string; username?: string } | null = null;
  try {
    tgUser = JSON.parse(validatedData.user ?? 'null');
  } catch {
    return res.status(400).json({ error: 'Invalid user data in initData' });
  }

  if (!tgUser?.id) {
    return res.status(400).json({ error: 'No user in initData' });
  }

  // 3. Derive credentials
  const { email, password } = deriveCredentials(tgUser.id, botToken);
  const displayName = [tgUser.first_name, tgUser.username ? `@${tgUser.username}` : ''].filter(Boolean).join(' ');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 4. Try sign in first, then sign up
  let session = null;

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInData?.session) {
    session = signInData.session;
  } else {
    // Account doesn't exist yet — create it
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name:        displayName,
          telegram_id: tgUser.id,
          source:      'telegram_mini_app',
        },
      },
    });

    if (signUpError || !signUpData.session) {
      console.error('[tg-auth] signUp error:', signUpError?.message);
      return res.status(500).json({ error: 'Failed to create account: ' + (signUpError?.message ?? 'unknown') });
    }

    session = signUpData.session;
  }

  // 5. Upsert Telegram profile into public.profiles (uses user JWT — no service role needed)
  try {
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    });
    const tgFull = tgUser as Record<string, unknown>;
    await userClient.from('profiles').upsert(
      {
        id:                  session.user.id,
        telegram_id:         tgUser.id,
        telegram_username:   tgUser.username   ?? null,
        telegram_first_name: tgUser.first_name ?? null,
        telegram_last_name:  (tgFull.last_name  as string) ?? null,
        telegram_photo_url:  (tgFull.photo_url  as string) ?? null,
      },
      { onConflict: 'id' },
    );
  } catch (err) {
    // Profile upsert is best-effort — don't fail the auth response
    console.warn('[tg-auth] profile upsert skipped:', err);
  }

  await writeAuditLog(session.user.id, 'tg_auth_login', { telegram_id: tgUser.id }, req);

  return res.status(200).json({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    user: {
      id:          session.user.id,
      email:       session.user.email,
      name:        displayName,
      telegram_id: tgUser.id,
    },
  });
}
