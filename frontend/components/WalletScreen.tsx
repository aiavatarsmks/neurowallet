import React from 'react';

export interface CryptoAsset {
  symbol: string;
  name: string;
  amount: number;
  amountDisplay: string;
  valueEUR: number;
  change24h: number;
  color: string;
  bgColor: string;
  icon: string;
}

export const CRYPTO_ASSETS: CryptoAsset[] = [
  {
    symbol: 'BTC',  name: 'Bitcoin',  amount: 0.042, amountDisplay: '0.042 BTC',
    valueEUR: 2310,  change24h: +4.2,  color: '#F7931A', bgColor: 'rgba(247,147,26,0.13)', icon: '₿',
  },
  {
    symbol: 'ETH',  name: 'Ethereum', amount: 1.24,  amountDisplay: '1.24 ETH',
    valueEUR: 2542,  change24h: +1.8,  color: '#627EEA', bgColor: 'rgba(98,126,234,0.13)',  icon: 'Ξ',
  },
  {
    symbol: 'USDT', name: 'Tether',   amount: 110,   amountDisplay: '110 USDT',
    valueEUR: 110,   change24h: 0,     color: '#26A17B', bgColor: 'rgba(38,161,123,0.13)',  icon: '₮',
  },
];

const CRYPTO_TOTAL = CRYPTO_ASSETS.reduce((s, a) => s + a.valueEUR, 0);
const FIAT = 2847.50;
const CHART_BARS = [35,48,40,58,44,66,60,72,55,78,68,82,88,78,92];

interface WalletScreenProps {
  onSendCrypto: (symbol: string) => void;
  onReceiveCrypto: (symbol: string) => void;
}

export const WalletScreen: React.FC<WalletScreenProps> = ({ onSendCrypto, onReceiveCrypto }) => {
  const total = FIAT + CRYPTO_TOTAL;

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col gap-5">

      {/* Portfolio summary card */}
      <div
        className="rounded-3xl p-5"
        style={{
          background: 'linear-gradient(135deg, rgba(0,255,127,0.09) 0%, rgba(0,255,127,0.03) 100%)',
          border: '1px solid rgba(0,255,127,0.18)',
        }}
      >
        <p className="text-[#3A6045] text-xs font-medium mb-1">Крипто-портфель</p>
        <p className="text-white text-3xl font-bold tracking-tight">
          €{CRYPTO_TOTAL.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#00FF7F] text-sm font-semibold">+€521.30</span>
          <span className="text-[#3A6045] text-xs">+11.7% за месяц</span>
        </div>

        {/* Mini chart */}
        <div className="mt-3 h-12 flex items-end gap-px">
          {CHART_BARS.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all"
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

      {/* Fiat row */}
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
            <p className="text-[#3A6045] text-xs">Текущий счёт</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-white text-sm font-semibold">€{FIAT.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</p>
          <p className="text-[#3A6045] text-xs">стабильно</p>
        </div>
      </div>

      {/* Crypto assets */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">Крипто-активы</p>
        <div className="flex flex-col gap-3">
          {CRYPTO_ASSETS.map((asset) => (
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
                  <p className="text-[#3A6045] text-xs">{asset.amountDisplay}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white text-sm font-semibold">€{asset.valueEUR.toLocaleString('ru-RU')}</p>
                  <p
                    className="text-xs font-semibold"
                    style={{ color: asset.change24h > 0 ? '#00FF7F' : asset.change24h < 0 ? '#FF5252' : '#3A6045' }}
                  >
                    {asset.change24h > 0 ? '+' : ''}{asset.change24h}% 24ч
                  </p>
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
          <p className="text-[#3A6045] text-xs">Общий капитал (фиат + крипто)</p>
          <p className="text-white text-xl font-bold mt-0.5">€{total.toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="text-right">
          <p className="text-[#00FF7F] text-sm font-semibold">+8.7%</p>
          <p className="text-[#3A6045] text-xs">за месяц</p>
        </div>
      </div>

      {/* Staking */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'linear-gradient(135deg, rgba(0,255,127,0.06) 0%, rgba(0,255,127,0.02) 100%)', border: '1px solid rgba(0,255,127,0.12)' }}
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

export default WalletScreen;
