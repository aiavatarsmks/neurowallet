/**
 * Приёмка 1.3: «тестовый набор poisoning-паттернов флагается».
 * Набор ниже — эталонные атаки address poisoning + легитимные кейсы,
 * которые НЕ должны флагаться (ложные блоки хуже пропусков warning'а).
 */
import { describe, it, expect } from 'vitest';
import { assessRecipient, levenshtein, looksLikePoisoning } from '@/lib/risk/engine';

const ETH_KNOWN = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const TRON_KNOWN = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const SOL_KNOWN = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('levenshtein', () => {
  it('computes classic distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('poisoning pattern set (must flag)', () => {
  it('same visible edges, different middle (classic ETH poisoning)', () => {
    const poisoned = '0x71c765' + 'a'.repeat(30) + '976f'; // префикс и суффикс совпадают
    expect(looksLikePoisoning(poisoned, ETH_KNOWN)).toBe(true);
    const r = assessRecipient({ coin: 'ETH', toAddress: poisoned, history: [ETH_KNOWN] });
    expect(r.level).toBe('block');
    expect(r.reasons[0].code).toBe('poisoning_similarity');
    expect(r.overridable).toBe(true);
    expect(r.reasons[0].similarTo).toContain('0x71c765');
  });

  it('one-character substitution (near-identical address)', () => {
    const poisoned = ETH_KNOWN.slice(0, 20) + 'x' + ETH_KNOWN.slice(21);
    const r = assessRecipient({ coin: 'ETH', toAddress: poisoned, history: [ETH_KNOWN] });
    expect(r.level).toBe('block');
    expect(r.reasons[0].code).toBe('poisoning_similarity');
  });

  it('TRON base58 twin with matching edges', () => {
    const poisoned = TRON_KNOWN.slice(0, 6) + 'XXXXXXXXXXXXXXXXXXXXXXXX' + TRON_KNOWN.slice(-4);
    const r = assessRecipient({ coin: 'TRX', toAddress: poisoned, history: [TRON_KNOWN] });
    expect(r.level).toBe('block');
  });

  it('few scattered edits within threshold on SOL', () => {
    const chars = SOL_KNOWN.split('');
    chars[10] = chars[10] === 'a' ? 'b' : 'a';
    chars[20] = chars[20] === 'c' ? 'd' : 'c';
    const r = assessRecipient({ coin: 'SOL', toAddress: chars.join(''), history: [SOL_KNOWN] });
    expect(r.level).toBe('block');
    expect(r.reasons[0].code).toBe('poisoning_similarity');
  });
});

describe('legitimate cases (must NOT flag as poisoning)', () => {
  it('exact match from history → ok (green shield)', () => {
    const r = assessRecipient({ coin: 'ETH', toAddress: ETH_KNOWN, history: [ETH_KNOWN] });
    expect(r.level).toBe('ok');
    expect(r.reasons[0].code).toBe('known_recipient');
  });

  it('ETH case variation is the SAME address, not poisoning', () => {
    const checksummed = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    const r = assessRecipient({ coin: 'ETH', toAddress: checksummed, history: [ETH_KNOWN] });
    expect(r.level).toBe('ok');
  });

  it('genuinely different address → warning first_seen, not block', () => {
    const other = '0x' + '9'.repeat(40);
    const r = assessRecipient({ coin: 'ETH', toAddress: other, history: [ETH_KNOWN] });
    expect(r.level).toBe('warning');
    expect(r.reasons[0].code).toBe('first_seen');
    expect(r.overridable).toBe(true);
  });

  it('contact match counts as known recipient', () => {
    const r = assessRecipient({ coin: 'SOL', toAddress: SOL_KNOWN, history: [], contacts: [SOL_KNOWN] });
    expect(r.level).toBe('ok');
  });

  it('empty history (pre-migration degradation) → every address is first_seen', () => {
    const r = assessRecipient({ coin: 'TON', toAddress: 'EQA2qqtv2MASYNxCAjSB740ly2JELsh56uWl1rBeH4jWIs5v', history: [] });
    expect(r.level).toBe('warning');
  });
});

describe('blocklist', () => {
  it('blocklisted address → block without override', () => {
    const bad = '0x' + 'b'.repeat(40);
    const r = assessRecipient({
      coin: 'ETH',
      toAddress: bad.toUpperCase().replace('0X', '0x'),
      history: [],
      blocklist: { ETH: new Set([bad]) },
    });
    expect(r.level).toBe('block');
    expect(r.reasons[0].code).toBe('blocklisted');
    expect(r.overridable).toBe(false);
  });
});
