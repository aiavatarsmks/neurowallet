/**
 * lib/risk/blocklist.ts — локальный блок-лист адресов (задача 1.3).
 *
 * Поставляется ПУСТЫМ намеренно (см. NIGHT_DECISIONS.md D-1.3-3): наполнение
 * скам/санкционными адресами — осознанное действие владельца продукта, не
 * автоматика. Механика полностью покрыта тестами через инжектируемые записи.
 * Vendor-фиды (Blockaid/TRM-класс) — Фаза 2.
 *
 * Формат: coin → Set нормализованных адресов (ETH — lowercase).
 */

import type { SimCoin } from '../crypto/simulate';

export type Blocklist = Partial<Record<SimCoin, ReadonlySet<string>>>;

export const BLOCKLIST: Blocklist = {
  // ETH:  new Set(['0x…']),
  // TRX:  new Set(['T…']),
};
