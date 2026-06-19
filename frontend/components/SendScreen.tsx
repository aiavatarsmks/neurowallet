import React, { useState } from 'react';

interface Contact {
  id: string;
  name: string;
  initials: string;
  trusted: boolean;
  lastAmount?: string;
}

const MOCK_CONTACTS: Contact[] = [
  { id: '1', name: 'John Doe',     initials: 'JD', trusted: true,  lastAmount: '$1,200' },
  { id: '2', name: 'Alice Kim',    initials: 'AK', trusted: true,  lastAmount: '$340'   },
  { id: '3', name: 'Mike Ross',    initials: 'MR', trusted: false, lastAmount: undefined },
];

type SendStep = 'contacts' | 'amount' | 'confirm' | 'done';

interface SendScreenProps {
  onAvatarState?: (state: 'idle' | 'talking' | 'thinking') => void;
}

export const SendScreen: React.FC<SendScreenProps> = ({ onAvatarState }) => {
  const [step, setStep] = useState<SendStep>('contacts');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const handleSelectContact = (c: Contact) => {
    setSelected(c);
    onAvatarState?.('thinking');
    setTimeout(() => {
      onAvatarState?.('idle');
      setStep('amount');
    }, 800);
  };

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
          style={{ background: 'rgba(0,255,127,0.12)', border: '2px solid #00FF7F' }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div>
          <p className="text-white text-xl font-bold">${parseFloat(amount || '0').toFixed(2)} отправлено</p>
          <p className="text-[#3A6045] text-sm mt-1">{selected?.name} • только что</p>
        </div>
        <div
          className="w-full rounded-2xl p-4 text-left"
          style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">Нейра</p>
          <p className="text-white text-sm">Перевод залогирован. Получатель верифицирован, реквизиты совпадают. ✓ Аудит-запись сохранена.</p>
        </div>
        <button
          onClick={() => { setStep('contacts'); setAmount(''); setNote(''); setSelected(null); }}
          className="w-full py-4 rounded-2xl font-semibold text-sm"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          Новый перевод
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 pt-2 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">Отправить</h2>

      {/* Contacts */}
      {step === 'contacts' && (
        <div className="flex flex-col gap-3">
          <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider">Последние контакты</p>
          {MOCK_CONTACTS.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelectContact(c)}
              className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
                style={{ background: c.trusted ? 'rgba(0,255,127,0.12)' : '#1a1a1a', color: c.trusted ? '#00FF7F' : '#fff' }}
              >
                {c.initials}
              </div>
              <div className="flex-1">
                <p className="text-white font-medium text-sm">{c.name}</p>
                {c.lastAmount && <p className="text-[#3A6045] text-xs mt-0.5">Последний: {c.lastAmount}</p>}
              </div>
              {c.trusted && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(0,255,127,0.1)', color: '#00FF7F' }}>
                  ✓ Доверенный
                </span>
              )}
            </button>
          ))}

          {/* New recipient */}
          <button
            className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
            style={{ background: 'transparent', border: '1.5px dashed rgba(0,255,127,0.2)' }}
            onClick={() => handleSelectContact({ id: 'new', name: 'Новый получатель', initials: '+', trusted: false })}
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(0,255,127,0.06)' }}>
              <span className="text-[#00FF7F] text-xl font-light">+</span>
            </div>
            <p className="text-[#3A6045] text-sm">Новый получатель</p>
          </button>
        </div>
      )}

      {/* Amount input */}
      {step === 'amount' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('contacts')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Назад
          </button>

          {/* Recipient pill */}
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#0D1A10' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs" style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F' }}>
              {selected.initials}
            </div>
            <p className="text-white text-sm font-medium">{selected.name}</p>
          </div>

          {/* Amount */}
          <div className="text-center py-6">
            <p className="text-[#3A6045] text-xs mb-3">Сумма</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[#00FF7F] text-5xl font-bold">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="text-white text-5xl font-bold bg-transparent outline-none w-40 text-center"
                style={{ caretColor: '#00FF7F' }}
                autoFocus
              />
            </div>
          </div>

          {/* Note */}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Заметка (необязательно)"
            className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
          />

          {/* Neura trust check */}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.12)' }}>
            <p className="text-[#00FF7F] text-xs font-semibold mb-1.5">Нейра</p>
            {selected.trusted
              ? <p className="text-white text-sm">{selected.name} — доверенный контакт. {selected.lastAmount ? `Последний перевод: ${selected.lastAmount}.` : ''} Реквизиты совпадают ✓</p>
              : <p className="text-white text-sm">⚠️ Получатель не в истории переводов. Рекомендую верифицировать вручную перед отправкой.</p>
            }
          </div>

          <button
            onClick={() => setStep('confirm')}
            disabled={!amount || parseFloat(amount) <= 0}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            Продолжить
          </button>
        </div>
      )}

      {/* Confirm */}
      {step === 'confirm' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('amount')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Назад
          </button>

          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>
            <div className="flex justify-between">
              <span className="text-[#3A6045] text-sm">Получатель</span>
              <span className="text-white text-sm font-medium">{selected.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#3A6045] text-sm">Сумма</span>
              <span className="text-[#00FF7F] text-sm font-bold">${parseFloat(amount).toFixed(2)}</span>
            </div>
            {note && (
              <div className="flex justify-between">
                <span className="text-[#3A6045] text-sm">Заметка</span>
                <span className="text-white text-sm">{note}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#3A6045] text-sm">Статус проверки</span>
              <span className="text-sm font-semibold" style={{ color: selected.trusted ? '#00FF7F' : '#f59e0b' }}>
                {selected.trusted ? '✓ Верифицирован' : '⚠ Ручная проверка'}
              </span>
            </div>
          </div>

          <button
            onClick={handleSend}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 20px rgba(0,255,127,0.3)' }}
          >
            Подтвердить и отправить
          </button>
        </div>
      )}
    </div>
  );
};

export default SendScreen;
