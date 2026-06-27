import { supabase } from '@/lib/supabase';

export type NeuroCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export interface NeuroDirectoryRow {
  user_id: string;
  neuro_id: string;
  display_name: string | null;
  eth_address: string | null;
  sol_address: string | null;
  btc_address: string | null;
  tron_address: string | null;
  ton_address: string | null;
  updated_at?: string;
}

export function normalizeNeuroId(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export function neuroIdFromUserId(userId: string): string {
  return `nw-${userId.replace(/-/g, '').slice(0, 12)}`;
}

export function isNeuroId(value: string): boolean {
  return /^nw-[a-z0-9]{8,32}$/.test(normalizeNeuroId(value));
}

export function getAddressForCoin(row: Partial<NeuroDirectoryRow>, coin: NeuroCoin): string {
  if (coin === 'BTC') return row.btc_address ?? '';
  if (coin === 'SOL') return row.sol_address ?? '';
  if (coin === 'TRX' || coin === 'TRC20') return row.tron_address ?? '';
  if (coin === 'TON' || coin === 'USDT_TON') return row.ton_address ?? '';
  return row.eth_address ?? '';
}

export function getLocalWalletAddresses() {
  if (typeof window === 'undefined') {
    return { eth: '', sol: '', btc: '', tron: '', ton: '' };
  }
  return {
    eth: localStorage.getItem('wallet_eth_address') ?? '',
    sol: localStorage.getItem('wallet_sol_address') ?? '',
    btc: localStorage.getItem('wallet_btc_address') ?? '',
    tron: localStorage.getItem('wallet_tron_address') ?? '',
    ton: localStorage.getItem('wallet_ton_address') ?? '',
  };
}

export async function syncMyNeuroDirectory(displayName: string): Promise<NeuroDirectoryRow | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const addresses = getLocalWalletAddresses();
  const row: NeuroDirectoryRow = {
    user_id: user.id,
    neuro_id: neuroIdFromUserId(user.id),
    display_name: displayName || user.email || 'NeuroWallet user',
    eth_address: addresses.eth || null,
    sol_address: addresses.sol || null,
    btc_address: addresses.btc || null,
    tron_address: addresses.tron || null,
    ton_address: addresses.ton || null,
  };

  const { error } = await supabase.from('neuro_directory').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.warn('[neuro-id] sync skipped:', error.message);
    return row;
  }

  return row;
}
