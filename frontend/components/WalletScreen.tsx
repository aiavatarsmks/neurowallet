import React, { useState, useEffect } from 'react';
import { fetchRealBalances, WalletBalances } from '@/lib/crypto/balances';

// ─── Demo data (shown when no real wallet is set up) ──────────────────────

const DEMO_ASSETS = [
  { symbol: 'BTC',      name: 'Bitcoin',      amount: 0.042, valueEUR: 2310, change24h: +4.2, color: '#F7931A', bgColor: 'rgba(247,147,26,0.13)',  icon: '₿'  },
  { symbol: 'ETH',      name: 'Ethereum',     amount: 1.24,  valueEUR: 2542, change24h: +1.8, color: '#627EEA', bgColor: 'rgba(98,126,234,0.13)',   icon: 'Ξ'  },
  { symbol: 'SOL',      name: 'Solana',       amount: 12.5,  valueEUR: 1500, change24h: +3.4, color: '#9945FF', bgColor: 'rgba(153,69,255,0.13)',   icon: '◎' },
  { symbol: 'USDT',     name: 'USDT ERC-20',  amount: 110,   valueEUR: 110,  change24h: 0,    color: '#26A17B', bgColor: 'rgba(38,161,123,0.13)',   icon: '₮'  },
  { symbol: 'TRX',      name: 'TRON',         amount: 0,     valueEUR: 0,    change24h: 0,    color: '#EF0027', bgColor: 'rgba(239,0,39,0.13)',     icon: '◆'  },
  { symbol: 'USDT_TRC', name: 'USDT TRC-20',  amount: 0,     valueEUR: 0,    change24h: 0,    color: '#EF0027', bgColor: 'rgba(239,0,39,0.13)',     icon: '₮'  },
  { symbol: 'TON',      name: 'TON',           amount: 0,     valueEUR: 0,    change24h: 0,    color: '#0098EA', bgColor: 'rgba(0,152,234,0.13)',    icon: '💎' },
  { symbol: 'USDT_TON', name: 'USDT TON',      amount: 0,     valueEUR: 0,    change24h: 0,    color: '#0098EA', bgColor: 'rgba(0,152,234,0.10)',    icon: '₮'  },
];

const CHART_BARS = [35, 48, 40, 58, 44, 66, 60, 72, 55, 78, 68, 82, 88, 78, 92];

// ─── Types ─────────────────────────────────────────────────────────────────

interface AssetRow {
  symbol:    string;
  name:      string;
  amount:    number;
  valueEUR:  number;
  change24h: number;
  color:     string;
  bgColor:   string;
  icon:      string;
}

interface WalletScreenProps {
  onSendCrypto:    (symbol: string) => void;
  onReceiveCrypto: (symbol: string) => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

export const WalletScreen: React.FC<WalletScreenProps> = ({ onSendCrypto, onReceiveCrypto }) => {
  const [assets,  setAssets]  = useState<AssetRow[]>(DEMO_ASSETS);
  const [loading, setLoading] = useState(false);
  const [isReal,  setIsReal]  = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';
    if (!eth) return; // demo mode — keep demo assets

    setIsReal(true);
    setLoading(true);

    fetchRealBalances(eth, sol, btc, tron, ton).then((b: WalletBalances) => {
      setAssets([
        { symbol: 'BTC',      name: 'Bitcoin',     amount: b.btc,     valueEUR: b.btc     * b.btcEur, change24h: 0, color: '#F7931A', bgColor: 'rgba(247,147,26,0.13)',  icon: '₿'  },
        { symbol: 'ETH',      name: 'Ethereum',    amount: b.eth,     valueEUR: b.eth     * b.ethEur, change24h: 0, color: '#627EEA', bgColor: 'rgba(98,126,234,0.13)',  icon: 'Ξ'  },
        { symbol: 'SOL',      name: 'Solana',      amount: b.sol,     valueEUR: b.sol     * b.solEur, change24h: 0, color: '#9945FF', bgColor: 'rgba(153,69,255,0.13)',  icon: '◎' },
        { symbol: 'USDT',     name: 'USDT ERC-20', amount: b.usdt,    valueEUR: b.usdt,              change24h: 0, color: '#26A17B', bgColor: 'rgba(38,161,123,0.13)',  icon: '₮'  },
        { symbol: 'TRX',      name: 'TRON',        amount: b.trx,     valueEUR: b.trx     * b.trxEur, change24h: 0, color: '#EF0027', bgColor: 'rgba(239,0,39,0.13)',    icon: '◆'  },
        { symbol: 'USDT_TRC', name: 'USDT TRC-20', amount: b.usdtTrc, valueEUR: b.usdtTrc,           change24h: 0, color: '#EF0027', bgColor: 'rgba(239,0,39,0.13)',    icon: '₮'  },
        { symbol: 'TON',      name: 'TON',          amount: b.ton,     valueEUR: b.ton     * b.tonEur, change24h: 0, color: '#0098EA', bgColor: 'rgba(0,152,234,0.13)', icon: '💎' },
        { symbol: 'USDT_TON', name: 'USDT TON',     amount: b.usdtTon, valueEUR: b.usdtTon,           change24h: 0, color: '#0098EA', bgColor: 'rgba(0,152,234,0.10)', icon: '₮'  },
      ]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // In real mode: always show base coins and TRX (needed for Tron fees).
  const BASE_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX']);
  const visibleAssets = isReal
    ? assets.filter((a) => BASE_SYMBOLS.has(a.symbol) || a.amount > 0)
    : assets;

  const cryptoTotal = visibleAssets.reduce((s, a) => s + a.valueEUR, 0);
  const FIAT        = isReal ? 0 : 2847.50;

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col gap-5">

      {/* Portfolio summary card */}
      <div
        className="rounded-3xl p-5"
        style={{
          background: 'linear-gradient(135deg, rgba(0,255,127,0.09) 0%, rgba(0,255,127,0.03) 100%)',
          border:     '1px solid rgba(0,255,127,0.18)',
        }}
      >
        <p className="text-[#3A6045] text-xs font-medium mb-1">
          {isReal ? 'Реальный крипто-портфель' : 'Крипто-портфель (демо)'}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full bg-[#00FF7F] opacity-60" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
            <span className="text-[#3A6045] text-sm">Загружаем балансы...</span>
            <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
          </div>
        ) : (
          <p className="text-white text-3xl font-bold tracking-tight">
            €{cryptoTotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        )}

        {/* Mini chart */}
        <div className="mt-3 h-12 flex items-end gap-px">
          {CHART_BARS.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${h}%`,
                background: i === CHART_BARS.length - 1
                  ? '#00FF7F'
                  : `rgba(0,255,127,${0.15 + i * 0.035})`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Fiat row (hidden when real wallet active) */}
      {!isReal && (
        <div
          className="flex items-center justify-between rounded-2xl px-4 py-3"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F', border: '1px solid rgba(0,255,127,0.2)' }}
            >
              €
            </div>
            <div>
              <p className="text-white text-sm font-medium">Евро EUR</p>
              <p className="text-[#3A6045] text-xs">Текущий счёт (демо)</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-white text-sm font-semibold">
              €{FIAT.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[#3A6045] text-xs">стабильно</p>
          </div>
        </div>
      )}

      {/* Crypto assets */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">Крипто-активы</p>
        <div className="flex flex-col gap-3">
          {visibleAssets.map((asset) => (
            <div
              key={asset.symbol}
              className="rounded-2xl p-4"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0"
                  style={{ background: asset.bgColor, color: asset.color, border: `1px solid ${asset.color}44` }}
                >
                  {asset.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{asset.name}</p>
                  <p className="text-[#3A6045] text-xs">
                    {loading ? '...' : `${asset.amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${asset.symbol.replace('_TRC', '').replace('_TON', '')}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-semibold">
                    {loading ? '—' : `€${asset.valueEUR.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`}
                  </p>
                  {asset.change24h !== 0 && (
                    <p
                      className="text-xs font-semibold"
                      style={{ color: asset.change24h > 0 ? '#00FF7F' : '#FF5252' }}
                    >
                      {asset.change24h > 0 ? '+' : ''}{asset.change24h}% 24ч
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onSendCrypto(asset.symbol)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                  style={{ background: 'transparent', border: `1px solid ${asset.color}55`, color: asset.color }}
                >
                  Отправить
                </button>
                <button
                  onClick={() => onReceiveCrypto(asset.symbol)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                  style={{ background: asset.bgColor, border: `1px solid ${asset.color}33`, color: '#ffffff' }}
                >
                  Получить
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total net worth */}
      <div
        className="rounded-2xl p-4 flex justify-between items-center"
        style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.1)' }}
      >
        <div>
          <p className="text-[#3A6045] text-xs">{isReal ? 'Крипто-портфель' : 'Общий капитал (фиат + крипто)'}</p>
          <p className="text-white text-xl font-bold mt-0.5">
            €{(cryptoTotal + (isReal ? 0 : FIAT)).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
          </p>
        </div>
        {!isReal && (
          <div className="text-right">
            <p className="text-[#00FF7F] text-sm font-semibold">+8.7%</p>
            <p className="text-[#3A6045] text-xs">за месяц</p>
          </div>
        )}
      </div>

      {/* Staking */}
      <div
        className="rounded-2xl p-4"
        style={{
          background: 'linear-gradient(135deg, rgba(0,255,127,0.06) 0%, rgba(0,255,127,0.02) 100%)',
          border:     '1px solid rgba(0,255,127,0.12)',
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-white text-sm font-semibold">Стейкинг ETH</p>
          <span
            className="text-[#00FF7F] text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,255,127,0.1)' }}
          >
            до 5.2% APY
          </span>
        </div>
        <p className="text-[#3A6045] text-xs">Зарабатывай на крипто, пока Нейра следит за рынком</p>
        <button
          className="mt-3 w-full py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)', color: '#00FF7F' }}
          onClick={() => {}}
        >
          Подключить стейкинг
        </button>
      </div>
    </div>
  );
};

// Export CRYPTO_ASSETS for backward compat (CryptoSendScreen uses it via wallet.tsx)
export const CRYPTO_ASSETS = DEMO_ASSETS;
export type  CryptoAsset   = AssetRow;

export default WalletScreen;
