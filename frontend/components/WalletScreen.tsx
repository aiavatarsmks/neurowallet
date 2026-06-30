import React, { useState, useEffect } from 'react';
import { fetchRealBalances, MARKET_REFRESH_MS, WalletBalances } from '@/lib/crypto/balances';
import { SUPPORTED_ASSETS, type AssetSymbol } from '@/lib/crypto/assets';
import { useAuth } from '@/contexts/AuthContext';

// ─── Demo data (shown when no real wallet is set up) ──────────────────────

const DEMO_ASSETS = [
  { ...SUPPORTED_ASSETS[0], amount: 0.042, valueEUR: 2310, change24h: +4.2, priceEUR: 55000 },
  { ...SUPPORTED_ASSETS[1], amount: 1.24,  valueEUR: 2542, change24h: +1.8, priceEUR: 2050 },
  { ...SUPPORTED_ASSETS[2], amount: 12.5,  valueEUR: 1500, change24h: +3.4, priceEUR: 120 },
  { ...SUPPORTED_ASSETS[3], amount: 110,   valueEUR: 110,  change24h: 0,    priceEUR: 1 },
  { ...SUPPORTED_ASSETS[4], amount: 0,     valueEUR: 0,    change24h: 0,    priceEUR: 0.22 },
  { ...SUPPORTED_ASSETS[5], amount: 0,     valueEUR: 0,    change24h: 0,    priceEUR: 1 },
  { ...SUPPORTED_ASSETS[6], amount: 0,     valueEUR: 0,    change24h: 0,    priceEUR: 3.5 },
  { ...SUPPORTED_ASSETS[7], amount: 0,     valueEUR: 0,    change24h: 0,    priceEUR: 1 },
];

const CHART_BARS = [35, 48, 40, 58, 44, 66, 60, 72, 55, 78, 68, 82, 88, 78, 92];

// ─── Types ─────────────────────────────────────────────────────────────────

interface AssetRow {
  symbol:    AssetSymbol;
  name:      string;
  unit:      string;
  amount:    number;
  valueEUR:  number;
  priceEUR:  number;
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
  const { isDemo } = useAuth();
  const [assets,  setAssets]  = useState<AssetRow[]>(DEMO_ASSETS);
  const [loading, setLoading] = useState(false);
  const [isReal,  setIsReal]  = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      setAssets(DEMO_ASSETS);
      setIsReal(false);
      setLoading(false);
      return;
    }
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';
    if (!eth) return; // demo mode — keep demo assets

    setIsReal(true);
    setLoading(true);

    const loadBalances = () => {
      fetchRealBalances(eth, sol, btc, tron, ton).then((b: WalletBalances) => {
        const amounts: Record<AssetSymbol, number> = {
          BTC: b.btc,
          ETH: b.eth,
          SOL: b.sol,
          USDT: b.usdt,
          TRX: b.trx,
          USDT_TRC: b.usdtTrc,
          TON: b.ton,
          USDT_TON: b.usdtTon,
        };
        const prices: Record<AssetSymbol, number> = {
          BTC: b.btcEur,
          ETH: b.ethEur,
          SOL: b.solEur,
          USDT: 1,
          TRX: b.trxEur,
          USDT_TRC: 1,
          TON: b.tonEur,
          USDT_TON: 1,
        };
        const changes: Record<AssetSymbol, number> = {
          BTC: b.btcChange24h,
          ETH: b.ethChange24h,
          SOL: b.solChange24h,
          USDT: 0,
          TRX: b.trxChange24h,
          USDT_TRC: 0,
          TON: b.tonChange24h,
          USDT_TON: 0,
        };
        setAssets(SUPPORTED_ASSETS.map((asset) => ({
          ...asset,
          amount: amounts[asset.symbol],
          valueEUR: amounts[asset.symbol] * prices[asset.symbol],
          priceEUR: prices[asset.symbol],
          change24h: changes[asset.symbol],
        })));
        setLoading(false);
      }).catch(() => setLoading(false));
    };

    loadBalances();
    const timer = window.setInterval(loadBalances, MARKET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isDemo]);

  const visibleAssets = assets;

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
                    {loading
                      ? '...'
                      : `${asset.amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${asset.unit} · 1 ${asset.unit} ≈ €${asset.priceEUR.toLocaleString('ru-RU', { maximumFractionDigits: asset.priceEUR < 1 ? 4 : 2 })}`}
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
