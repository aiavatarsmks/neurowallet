import React, { useMemo, useState, useEffect } from 'react';

type Network = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRX';

const FALLBACK_ADDRESSES: Record<Network, string> = {
  BTC:  'bc1q742d35cc6634c0532925a3b844bc454e4438f44',
  ETH:  '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  SOL:  'AkELM1tRiHF9PMeRxSgD5UG4v7P3MtNzL8kqSEEtPkX',
  USDT: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  TON:  'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M',
  TRX:  'TQn9Y2khDD95AoRQBkz8ZJXsF9wdDXqcfF',
};

const NET_LABELS: Record<Network, string> = {
  BTC:  'Bitcoin Network',
  ETH:  'Ethereum (ERC-20)',
  SOL:  'Solana Network',
  USDT: 'Ethereum (ERC-20)',
  TON:  'TON Network',
  TRX:  'Tron Network (TRC-20)',
};

const COLORS: Record<Network, string> = {
  BTC:  '#F7931A',
  ETH:  '#627EEA',
  SOL:  '#9945FF',
  USDT: '#26A17B',
  TON:  '#0098EA',
  TRX:  '#EF0027',
};

const ICONS: Record<Network, string> = { BTC: '₿', ETH: 'Ξ', SOL: '◎', USDT: '₮', TON: '💎', TRX: '₮' };

const SIZE = 25;

function buildQR(seed: string): boolean[][] {
  const g: boolean[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

  const finder = (r: number, c: number) => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        g[r + i][c + j] =
          i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
      }
    }
  };
  finder(0, 0);
  finder(0, 18);
  finder(18, 0);

  for (let i = 8; i < 17; i++) {
    g[6][i] = i % 2 === 0;
    g[i][6] = i % 2 === 0;
  }
  g[8][8] = true;

  let h = 0;
  for (const ch of seed) h = ((h * 31 + ch.charCodeAt(0)) | 0);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= 17) || (r >= 17 && c < 8)) continue;
      if (r === 6 || c === 6) continue;
      h = ((h * 1664525 + 1013904223) >>> 0);
      g[r][c] = (h >>> 16) % 3 !== 0;
    }
  }
  return g;
}

interface ReceiveScreenProps {
  initialNetwork?: Network;
}

export const ReceiveScreen: React.FC<ReceiveScreenProps> = ({ initialNetwork = 'ETH' }) => {
  const [network, setNetwork] = useState<Network>(initialNetwork);
  const [copied, setCopied] = useState(false);
  const [addresses, setAddresses] = useState(FALLBACK_ADDRESSES);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const eth  = localStorage.getItem('wallet_eth_address');
    const sol  = localStorage.getItem('wallet_sol_address');
    const btc  = localStorage.getItem('wallet_btc_address');
    const ton  = localStorage.getItem('wallet_ton_address');
    const tron = localStorage.getItem('wallet_tron_address');
    setAddresses({
      ETH:  eth  || FALLBACK_ADDRESSES.ETH,
      SOL:  sol  || FALLBACK_ADDRESSES.SOL,
      BTC:  btc  || FALLBACK_ADDRESSES.BTC,
      USDT: eth  || FALLBACK_ADDRESSES.USDT,
      TON:  ton  || FALLBACK_ADDRESSES.TON,
      TRX:  tron || FALLBACK_ADDRESSES.TRX,
    });
  }, []);

  const address = addresses[network];
  const color   = COLORS[network];
  const qr      = useMemo(() => buildQR(address), [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col items-center gap-5">
      <h2 className="text-white text-lg font-bold self-start">Получить крипту</h2>

      {/* Network selector */}
      <div className="flex gap-2 self-stretch flex-wrap">
        {(['ETH', 'SOL', 'BTC', 'USDT', 'TON', 'TRX'] as Network[]).map((n) => (
          <button
            key={n}
            onClick={() => { setNetwork(n); setCopied(false); }}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 flex items-center justify-center gap-1.5"
            style={{
              background: network === n ? `${COLORS[n]}18` : '#0D1A10',
              border: `1.5px solid ${network === n ? COLORS[n] : 'rgba(0,255,127,0.08)'}`,
              color: network === n ? COLORS[n] : '#3A6045',
              minWidth: '60px',
            }}
          >
            <span>{ICONS[n]}</span>
            <span>{n}</span>
          </button>
        ))}
      </div>

      {/* QR Code */}
      <div
        className="rounded-3xl p-5 flex flex-col items-center gap-3"
        style={{ background: 'white' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
            gap: '1px',
            width: 190,
            height: 190,
          }}
        >
          {qr.flat().map((cell, i) => (
            <div
              key={i}
              style={{ background: cell ? '#000000' : 'transparent', aspectRatio: '1' }}
            />
          ))}
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1 rounded-full"
          style={{ background: `${color}18`, border: `1px solid ${color}55` }}
        >
          <span className="text-xs font-bold" style={{ color }}>{ICONS[network]}</span>
          <span className="text-xs font-medium" style={{ color }}>{NET_LABELS[network]}</span>
        </div>
      </div>

      {/* Address field */}
      <div
        className="self-stretch rounded-2xl px-4 py-3"
        style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
      >
        <p className="text-[#3A6045] text-[10px] uppercase tracking-wider mb-1.5">Адрес кошелька</p>
        <p className="text-white text-xs font-mono break-all leading-relaxed">{address}</p>
      </div>

      {/* Copy button */}
      <button
        onClick={copyAddress}
        className="self-stretch py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
        style={{
          background:    copied ? 'rgba(0,255,127,0.2)' : '#00FF7F',
          color:         '#080C09',
          boxShadow:     copied ? 'none' : '0 0 20px rgba(0,255,127,0.3)',
        }}
      >
        {copied ? '✓ Адрес скопирован!' : 'Копировать адрес'}
      </button>

      {/* Warning */}
      <div
        className="self-stretch rounded-2xl p-3.5"
        style={{ background: 'rgba(255,196,0,0.06)', border: '1px solid rgba(255,196,0,0.22)' }}
      >
        <p className="text-[#FFC400] text-xs leading-relaxed">
          {network === 'TON'
            ? '⚠️ Отправляйте только TON или USDT TON (Jetton) на этот адрес.'
            : network === 'TRX'
            ? '⚠️ Отправляйте только USDT TRC-20 или TRX на этот адрес.'
            : <>⚠️ Отправляйте только <strong>{network}</strong> на этот адрес.
          Отправка других монет может привести к безвозвратной потере средств.</>}
        </p>
      </div>
    </div>
  );
};

export default ReceiveScreen;
