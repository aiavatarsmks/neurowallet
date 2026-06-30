export type AssetSymbol = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'USDT_TRC' | 'TON' | 'USDT_TON';
export type AssetAddressKey = 'btc' | 'eth' | 'sol' | 'tron' | 'ton';

export interface CryptoAssetMeta {
  symbol: AssetSymbol;
  name: string;
  unit: string;
  addressLabel: string;
  addressKey: AssetAddressKey;
  icon: string;
  color: string;
  bgColor: string;
}

export const SUPPORTED_ASSETS: CryptoAssetMeta[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    unit: 'BTC',
    addressLabel: 'Bitcoin',
    addressKey: 'btc',
    icon: '₿',
    color: '#F7931A',
    bgColor: 'rgba(247,147,26,0.13)',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    unit: 'ETH',
    addressLabel: 'Ethereum',
    addressKey: 'eth',
    icon: 'Ξ',
    color: '#627EEA',
    bgColor: 'rgba(98,126,234,0.13)',
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    unit: 'SOL',
    addressLabel: 'Solana',
    addressKey: 'sol',
    icon: '◎',
    color: '#9945FF',
    bgColor: 'rgba(153,69,255,0.13)',
  },
  {
    symbol: 'USDT',
    name: 'USDT ERC-20',
    unit: 'USDT',
    addressLabel: 'USDT ERC-20',
    addressKey: 'eth',
    icon: '₮',
    color: '#26A17B',
    bgColor: 'rgba(38,161,123,0.13)',
  },
  {
    symbol: 'TRX',
    name: 'TRON',
    unit: 'TRX',
    addressLabel: 'TRX',
    addressKey: 'tron',
    icon: '◆',
    color: '#EF0027',
    bgColor: 'rgba(239,0,39,0.13)',
  },
  {
    symbol: 'USDT_TRC',
    name: 'USDT TRC-20',
    unit: 'USDT',
    addressLabel: 'USDT TRC-20',
    addressKey: 'tron',
    icon: '₮',
    color: '#EF0027',
    bgColor: 'rgba(239,0,39,0.13)',
  },
  {
    symbol: 'TON',
    name: 'TON',
    unit: 'TON',
    addressLabel: 'TON',
    addressKey: 'ton',
    icon: '💎',
    color: '#0098EA',
    bgColor: 'rgba(0,152,234,0.13)',
  },
  {
    symbol: 'USDT_TON',
    name: 'USDT TON',
    unit: 'USDT',
    addressLabel: 'USDT TON',
    addressKey: 'ton',
    icon: '₮',
    color: '#0098EA',
    bgColor: 'rgba(0,152,234,0.10)',
  },
];

export function explorerUrlForAsset(asset: CryptoAssetMeta, address: string): string | undefined {
  if (!address) return undefined;
  if (asset.addressKey === 'btc') return `https://blockstream.info/address/${address}`;
  if (asset.addressKey === 'eth') return `https://etherscan.io/address/${address}`;
  if (asset.addressKey === 'sol') return `https://solscan.io/account/${address}`;
  if (asset.addressKey === 'tron') return `https://tronscan.org/#/address/${address}`;
  if (asset.addressKey === 'ton') return `https://tonscan.org/address/${address}`;
  return undefined;
}
