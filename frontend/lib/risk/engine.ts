/**
 * lib/risk/engine.ts — детерминированный риск-скоринг получателя (задача 1.3).
 *
 * ОТДЕЛЬНЫЙ модуль, не фича внутри send: чистые функции без сети и состояния.
 * Инвариант CLAUDE.md: риск оценивает ТОЛЬКО детерминированный код — LLM
 * (Нейра) может лишь объяснять готовый результат, но не влияет на него.
 *
 * Уровни: ok (зелёный shield) / warning (жёлтый) / block (красный).
 * Причины объяснимы и типизированы — UI показывает каждую.
 *
 * MVP-эвристики:
 *  - blocklisted            → block, override невозможен (D-1.3-4)
 *  - poisoning_similarity   → block, override через явное подтверждение:
 *    адрес НЕ из истории, но совпадает с историческим по видимым краям
 *    (префикс ≥6 И суффикс ≥4) или близок по Левенштейну — классическая
 *    атака address poisoning (жертва копирует «похожий» адрес из истории)
 *  - first_seen             → warning (первый перевод на адрес)
 *  - known_recipient        → ok (точное совпадение с историей/контактами)
 */

import type { SimCoin } from '../crypto/simulate';
import { BLOCKLIST, type Blocklist } from './blocklist';

export type RiskLevel = 'ok' | 'warning' | 'block';

export type RiskReasonCode =
  | 'known_recipient'
  | 'first_seen'
  | 'poisoning_similarity'
  | 'blocklisted';

export interface RiskReason {
  code: RiskReasonCode;
  level: RiskLevel;
  /** Для poisoning_similarity — с каким известным адресом спутан (усечён для UI). */
  similarTo?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
  /** true, если block можно осознанно переопределить (см. D-1.3-4). */
  overridable: boolean;
}

export interface AssessParams {
  coin: SimCoin;
  toAddress: string;
  /** Адреса, на которые пользователь УЖЕ успешно отправлял (tx_drafts sent). */
  history: string[];
  /** Адресная книга (задача 1.4; пока пусто). */
  contacts?: string[];
  blocklist?: Blocklist;
}

/** ETH-подобные адреса регистронезависимы; base58/base64url чейны — нет. */
function normalize(coin: SimCoin, addr: string): string {
  const trimmed = addr.trim();
  return coin === 'ETH' || coin === 'USDT' ? trimmed.toLowerCase() : trimmed;
}

/** Классический O(n·m) Левенштейн; адреса ≤ 128 символов, история мала. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...new Array<number>(n)];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

const PREFIX_LEN = 6;
const SUFFIX_LEN = 4;

/** Порог Левенштейна: короткие адреса — 2, длинные — до 10% длины (max 6). */
function levThreshold(len: number): number {
  return Math.min(6, Math.max(2, Math.floor(len * 0.1)));
}

/**
 * true, если candidate выглядит как poisoning-двойник known:
 * совпадают видимые края (то, что пользователь сверяет глазами) ИЛИ строка
 * почти совпадает целиком — при этом адреса НЕ равны.
 */
export function looksLikePoisoning(candidate: string, known: string): boolean {
  if (candidate === known) return false;
  if (Math.abs(candidate.length - known.length) > 6) return false;

  const edgesMatch =
    candidate.slice(0, PREFIX_LEN) === known.slice(0, PREFIX_LEN) &&
    candidate.slice(-SUFFIX_LEN) === known.slice(-SUFFIX_LEN);
  if (edgesMatch) return true;

  return levenshtein(candidate, known) <= levThreshold(known.length);
}

export function assessRecipient(params: AssessParams): RiskAssessment {
  const { coin, toAddress, history, contacts = [], blocklist = BLOCKLIST } = params;
  const to = normalize(coin, toAddress);
  const knownSet = new Set([...history, ...contacts].map((a) => normalize(coin, a)));
  const reasons: RiskReason[] = [];

  if (blocklist[coin]?.has(to)) {
    reasons.push({ code: 'blocklisted', level: 'block' });
    return { level: 'block', reasons, overridable: false };
  }

  if (knownSet.has(to)) {
    reasons.push({ code: 'known_recipient', level: 'ok' });
    return { level: 'ok', reasons, overridable: true };
  }

  for (const known of knownSet) {
    if (looksLikePoisoning(to, known)) {
      reasons.push({
        code: 'poisoning_similarity',
        level: 'block',
        similarTo: known.length > 16 ? `${known.slice(0, 8)}…${known.slice(-6)}` : known,
      });
      return { level: 'block', reasons, overridable: true };
    }
  }

  reasons.push({ code: 'first_seen', level: 'warning' });
  return { level: 'warning', reasons, overridable: true };
}
