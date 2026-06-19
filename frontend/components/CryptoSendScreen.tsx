import React, { useState } from 'react';

type Coin = 'BTC' | 'ETH' | 'USDT';
type Step = 'form' | 'confirm' | 'done';

interface CoinInfo {
  icon: string;
  color: string;
  bgColor: string;
  available: number;
  priceEUR: number;
  placeholder: string;
}

const COINS: Record<Coin, CoinInfo> = {
  BTC:  { icon: '₿', color: '#F7931A', bgColor: 'rgba(247,147,26,0.15)', available: 0.042, priceEUR: 55000, placeholder: 'bc1q...' },
  ETH:  { icon: 'Ξ', color: '#627EEA', bgColor: 'rgba(98,126,234,0.15)',  available: 1.24,  priceEUR: 2050,  placeholder: '0x...' },
  USDT: { icon: '₮', color: '#26A17B', bgColor: 'rgba(38,161,123,0.15)', available: 110,   priceEUR: 1,     placeholder: 'T...' },
};

const FEE: Record<Coin, number> = { BTC: 0.80, ETH: 0.35, USDT: 0.05 };

interface CryptoSendScreenProps {
  initialCoin?: Coin;
  onAvatarState?: (s: 'idle' | 'talking' | 'thinking') => void;
}

export const CryptoSendScreen: React.FC<CryptoSendScreenProps> = ({
  initialCoin = 'BTC',
  onAvatarState,
}) => {
  const [coin, setCoin] = useState<Coin>(initialCoin);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('form');

  const data = COINS[coin];
  const amountNum = parseFloat(amount) || 0;
  const valueEUR = amountNum * data.priceEUR;
  const insufficient = amountNum > data.available;

  const reset = () => { setStep('form'); setAddress(''); setAmount(''); };

  const handleSend = () => {
    onAvatarState?.('talking');
    setStep('done');
    setTimeout(() => onAvatarState?.('idle'), 3000);
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center gap-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: data.bgColor, border: `2px solid ${data.color}` }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={data.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div>
          <p className="text-white text-xl font-bold">{amountNum} {coin} отправлено</p>
          <p className="text-[#3A6045] text-sm mt-1">≈ €{valueEUR.toFixed(2)} · только что</p>
        </div>
        <div className="w-full rounded-2xl p-4 text-left" style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)' }}>
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">Нейра</p>
          <p className="text-white text-sm">Транзакция отправлена в сеть. TX Hash записан в аудит-лог. Ожидается подтверждение через 1–2 мин.</p>
        </div>
        <button
          onClick={reset}
          className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          Новая транзакция
        </button>
      </div>
    );
  }

  if (step === 'confirm') {
    const shortAddr = address.length > 16 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
    return (
      <div className="px-6 pt-2 flex flex-col gap-4">
        <h2 className="text-white text-lg font-bold">Подтверждение</h2>

        <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>
          {[
            ['Монета', <span key="c" className="flex items-center gap-1.5"><span className="font-bold" style={{ color: data.color }}>{data.icon}</span><span className="text-white">{coin}</span></span>],
            ['Сумма', <span key="a" className="text-white font-bold">{amountNum} {coin}</span>],
            ['≈ EUR', <span key="e" className="font-semibold" style={{ color: '#00FF7F' }}>€{valueEUR.toFixed(2)}</span>],
            ['Комиссия', <span key="f" className="text-white">≈ €{FEE[coin]}</span>],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between items-center">
              <span className="text-[#3A6045] text-sm">{label}</span>
              <span className="text-sm">{val}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(0,255,127,0.1)', paddingTop: '12px' }}>
            <p className="text-[#3A6045] text-xs mb-1">Адрес получателя</p>
            <p className="text-white text-xs font-mono break-all">{address}</p>
          </div>
        </div>

        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.12)' }}>
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">Нейра</p>
          <p className="text-white text-xs leading-relaxed">
            Адрес не в адресной книге. Проверь первые и последние 6 символов перед отправкой: <span className="font-mono">{shortAddr}</span>
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'transparent', border: '1.5px solid rgba(0,255,127,0.15)', color: '#3A6045' }}
          >
            Назад
          </button>
          <button
            onClick={handleSend}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 20px rgba(0,255,127,0.3)' }}
          >
            Отправить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-2 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">Отправить крипту</h2>

      {/* Coin selector */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">Монета</p>
        <div className="flex gap-2">
          {(['BTC', 'ETH', 'USDT'] as Coin[]).map((c) => {
            const d = COINS[c];
            return (
              <button
                key={c}
                onClick={() => { setCoin(c); setAmount(''); }}
                className="flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 transition-all active:scale-95"
                style={{
                  background: coin === c ? d.bgColor : '#0D1A10',
                  border: `1.5px solid ${coin === c ? d.color : 'rgba(0,255,127,0.08)'}`,
                }}
              >
                <span className="text-lg font-bold" style={{ color: d.color }}>{d.icon}</span>
                <span className="text-[10px] font-semibold" style={{ color: coin === c ? d.color : '#3A6045' }}>{c}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[#3A6045] text-xs mt-2">
          Доступно:{' '}
          <span className="text-white font-medium">{data.available} {coin}</span>
          <span className="ml-1 text-[#3A6045]">(≈ €{(data.available * data.priceEUR).toLocaleString('ru-RU', { maximumFractionDigits: 0 })})</span>
        </p>
      </div>

      {/* Address */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">Адрес получателя</p>
        <div className="rounded-2xl px-4 py-3.5" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={data.placeholder}
            className="w-full bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045] font-mono"
            style={{ caretColor: '#00FF7F' }}
          />
        </div>
      </div>

      {/* Amount */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">Сумма</p>
        <div
          className="text-center py-5 rounded-2xl"
          style={{
            background: '#0D1A10',
            border: `1px solid ${insufficient ? 'rgba(255,82,82,0.4)' : 'rgba(0,255,127,0.12)'}`,
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold" style={{ color: data.color }}>{data.icon}</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="text-white text-4xl font-bold bg-transparent outline-none w-32 text-center"
              style={{ caretColor: '#00FF7F' }}
            />
            <span className="text-[#3A6045] text-lg font-bold">{coin}</span>
          </div>
          {amountNum > 0 && (
            <p className="text-[#3A6045] text-sm mt-1.5">
              {insufficient
                ? <span style={{ color: '#FF5252' }}>Недостаточно средств</span>
                : `≈ €${valueEUR.toFixed(2)}`}
            </p>
          )}
        </div>
      </div>

      <button
        onClick={() => setStep('confirm')}
        disabled={!address.trim() || !amountNum || insufficient}
        className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
        style={{ background: '#00FF7F', color: '#080C09' }}
      >
        Продолжить
      </button>
    </div>
  );
};

export default CryptoSendScreen;
