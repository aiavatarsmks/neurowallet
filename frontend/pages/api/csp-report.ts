/**
 * pages/api/csp-report.ts
 * Collects Content-Security-Policy violation reports (`report-uri` directive
 * in next.config.js). Browsers POST here on their own — there is no user
 * session, so protection is: per-IP rate limit, 10 kb body cap, and
 * deduplicated logging so a broken page cannot spam the logs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit } from '@/lib/server/api-security';

export const config = {
  api: { bodyParser: { sizeLimit: '10kb' } },
};

// Dedup window: log each (directive, blocked-uri) pair at most once per hour
// per lambda instance.
const DEDUP_WINDOW_MS = 60 * 60_000;
const MAX_DEDUP_ENTRIES = 500;
const seen = new Map<string, number>();

function shouldLog(key: string): boolean {
  const now = Date.now();
  if (seen.size > MAX_DEDUP_ENTRIES) seen.clear();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  seen.set(key, now);
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : null) ?? req.socket.remoteAddress ?? 'unknown';
  if (!(await checkRateLimit(`csp-report:${ip}`, 10))) {
    return res.status(429).end();
  }

  try {
    // Browsers send Content-Type: application/csp-report, which Next's JSON
    // body parser leaves as a raw string.
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const report = (raw?.['csp-report'] ?? raw ?? {}) as Record<string, unknown>;

    const directive = String(report['violated-directive'] ?? report['effective-directive'] ?? 'unknown');
    const blocked = String(report['blocked-uri'] ?? 'unknown').slice(0, 200);
    const documentUri = String(report['document-uri'] ?? 'unknown').slice(0, 200);

    if (shouldLog(`${directive}|${blocked}`)) {
      console.warn('[csp-report]', JSON.stringify({ directive, blocked, documentUri }));
    }
  } catch {
    // Malformed report — ignore silently, never error back to the browser.
  }

  return res.status(204).end();
}
