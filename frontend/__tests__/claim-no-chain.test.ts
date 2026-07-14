import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Invariant (задача 2.8, v1): the entire claim path makes NO chain action —
 * demo claim can never move real funds. We assert none of the claim modules
 * reference chain-send code (import or call). Structural guard that survives
 * refactors.
 */
const FILES = [
  'lib/claim-client.ts',
  'lib/server/claim.ts',
  'components/ClaimCreate.tsx',
  'pages/claim.tsx',
  'pages/api/claim/create.ts',
  'pages/api/claim/status.ts',
  'pages/api/claim/complete.ts',
];

// chain-send module + the send/broadcast functions it exports
const CHAIN = /crypto\/transactions|crypto\/(ton|tron|btc)-tx|\bsend(Eth|Ton|Btc|Sol|Trx|Usdt)\w*\(|broadcast/i;

describe('claim v1 — no chain action (demo invariant)', () => {
  for (const f of FILES) {
    it(`${f} does not touch chain-send code`, () => {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      expect(CHAIN.test(src)).toBe(false);
    });
  }
});
