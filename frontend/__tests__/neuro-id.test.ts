/**
 * Приёмка 1.4: «резолв детерминирован; коллизии невозможны».
 * NeuroID выводится детерминированно из uuid пользователя; жёсткая гарантия
 * уникальности — UNIQUE constraint на neuro_directory.neuro_id (0001).
 */
import { describe, it, expect } from 'vitest';

// lib/neuro-id импортирует supabase-клиент, который требует env при загрузке
// модуля — задаём ДО импорта.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
const { neuroIdFromUserId, isNeuroId, normalizeNeuroId, getAddressForCoin } = await import('@/lib/neuro-id');

describe('NeuroID (task 1.4 acceptance)', () => {
  it('derivation is deterministic — same user always gets the same id', () => {
    const uid = '4373edef-c4df-48ef-bf34-beaeb6f36c4a';
    expect(neuroIdFromUserId(uid)).toBe(neuroIdFromUserId(uid));
    expect(neuroIdFromUserId(uid)).toBe('nw-4373edefc4df');
  });

  it('derived ids always satisfy the directory CHECK constraint format', () => {
    for (const uid of ['00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
      expect(isNeuroId(neuroIdFromUserId(uid))).toBe(true);
    }
  });

  it('different users get different ids (uuid prefix)', () => {
    expect(neuroIdFromUserId('4373edef-c4df-48ef-bf34-beaeb6f36c4a')).not.toBe(
      neuroIdFromUserId('2f58557a-78c6-4720-bd87-ac18baf62790'),
    );
  });

  it('normalization strips @ and case', () => {
    expect(normalizeNeuroId('@NW-AbC123456789')).toBe('nw-abc123456789');
  });

  it('resolve maps coins to the right directory column', () => {
    const row = { eth_address: '0xE', sol_address: 'S', btc_address: 'B', tron_address: 'T', ton_address: 'N' };
    expect(getAddressForCoin(row, 'USDT')).toBe('0xE');
    expect(getAddressForCoin(row, 'TRC20')).toBe('T');
    expect(getAddressForCoin(row, 'USDT_TON')).toBe('N');
  });
});
