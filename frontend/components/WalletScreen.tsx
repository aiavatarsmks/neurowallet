import React, { useState, useEffect } from 'react';
import { fetchRealBalances, MARKET_REFRESH_MS, WalletBalances } from '@/lib/crypto/balances';
import { SUPPORTED_ASSETS, type AssetSymbol, type CryptoAssetMeta } from '@/lib/crypto/assets';
import { DEMO_HOLDINGS, demoValueEUR, DEMO_CHART_BARS, DEMO_FIAT_TOTAL_EUR } from '@/lib/demo-data';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayCurrency } from '@/contexts/DisplayCurrencyContext';
import { formatCryptoAmount, formatPercent } from '@/lib/display-format';

// ─── Demo data (shown when no real wallet is set up) ──────────────────────

// Demo assets derive from the shared demo dataset (lib/demo-data) so the
// portfolio, home card and send screen never diverge.
const ASSET_META: Record<AssetSymbol, CryptoAssetMeta> = Object.fromEntries(
  SUPPORTED_ASSETS.map((a) => [a.symbol, a]),
) as Record<AssetSymbol, CryptoAssetMeta>;

const DEMO_ASSETS = DEMO_HOLDINGS.map((h) => ({
  ...ASSET_META[h.symbol],
  amount: h.amount,
  valueEUR: demoValueEUR(h),
  change24h: h.change24h,
  priceEUR: h.priceEUR,
}));

const CHART_BARS = DEMO_CHART_BARS;

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
  const { t } = useLanguage();
  const { currency, symbol, formatFiat, convertFromEur } = useDisplayCurrency();
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
  const FIAT        = isReal ? 0 : DEMO_FIAT_TOTAL_EUR;

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
          {isReal ? t('walletRealPortfolio') : t('walletDemoPortfolio')}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full bg-[#00FF7F] opacity-60" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
            <span className="text-[#3A6045] text-sm">{t('walletLoadingBalances')}</span>
            <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
          </div>
        ) : (
          <p className="text-white text-3xl font-bold tracking-tight">
            {formatFiat(cryptoTotal)}
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
              {symbol}
            </div>
            <div>
              <p className="text-white text-sm font-medium">{currency === 'USD' ? 'US Dollar USD' : t('walletEuroFiat')}</p>
              <p className="text-[#3A6045] text-xs">{t('walletCurrentAccountDemo')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-white text-sm font-semibold">
              {formatFiat(FIAT)}
            </p>
            <p className="text-[#3A6045] text-xs">{t('walletStable')}</p>
          </div>
        </div>
      )}

      {/* Crypto assets */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">{t('walletCryptoAssetsTitle')}</p>
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
                      : `${formatCryptoAmount(asset.amount)} ${asset.unit} · 1 ${asset.unit} ≈ ${symbol}${convertFromEur(asset.priceEUR).toLocaleString('ru-RU', { maximumFractionDigits: asset.priceEUR < 1 ? 4 : 2 })}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-semibold">
                    {loading ? '—' : formatFiat(asset.valueEUR, { maximumFractionDigits: 2 })}
                  </p>
                  {asset.change24h !== 0 && (
                    <p
                      className="text-xs font-semibold"
                      style={{ color: asset.change24h > 0 ? '#00FF7F' : '#FF5252' }}
                    >
                      {formatPercent(asset.change24h)} {t('walletHours24')}
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
                  {t('send')}
                </button>
                <button
                  onClick={() => onReceiveCrypto(asset.symbol)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                  style={{ background: asset.bgColor, border: `1px solid ${asset.color}33`, color: '#ffffff' }}
                >
                  {t('receive')}
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
          <p className="text-[#3A6045] text-xs">{isReal ? t('walletTotalCryptoPortfolio') : t('walletTotalNetWorth')}</p>
          <p className="text-white text-xl font-bold mt-0.5">
            {formatFiat(cryptoTotal + (isReal ? 0 : FIAT))}
          </p>
        </div>
        {!isReal && (
          <div className="text-right">
            <p className="text-[#00FF7F] text-sm font-semibold">+8.7%</p>
            <p className="text-[#3A6045] text-xs">{t('walletPerMonth')}</p>
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
          <p className="text-white text-sm font-semibold">{t('walletStakingTitle')}</p>
          <span
            className="text-[#00FF7F] text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: 'rgba(0,255,127,0.1)' }}
          >
            {t('walletStakingApy')}
          </span>
        </div>
        <p className="text-[#3A6045] text-xs">{t('walletStakingDesc')}</p>
        <button
          className="mt-3 w-full py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)', color: '#00FF7F' }}
          onClick={() => {}}
        >
          {t('walletConnectStaking')}
        </button>
      </div>
    </div>
  );
};

// Export CRYPTO_ASSETS for backward compat (CryptoSendScreen uses it via wallet.tsx)
export const CRYPTO_ASSETS = DEMO_ASSETS;
export type  CryptoAsset   = AssetRow;

export default WalletScreen;
