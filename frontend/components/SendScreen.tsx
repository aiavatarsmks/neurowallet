import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { isNeuroId, normalizeNeuroId } from '@/lib/neuro-id';

type TransferCurrency = 'EUR' | 'USD' | 'USDT' | 'ETH' | 'BTC' | 'SOL' | 'TON' | 'TRC20' | 'USDT_TON';
type CryptoCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRC20' | 'TON' | 'USDT_TON';

interface Contact {
  id: string;
  name: string;
  initials: string;
  trusted: boolean;
  lastAmount?: string;
  currency?: TransferCurrency;
  address?: string;
}

const STORAGE_KEY = 'nw_recipients_v1';
const INVITE_URL = 'https://neurovalet.tech';

const DEMO_CONTACTS: Contact[] = [
  { id: '1', name: 'John Doe',   initials: 'JD', trusted: true,  lastAmount: '€150', currency: 'EUR' },
  { id: '2', name: 'Alice Kim',  initials: 'AK', trusted: true,  lastAmount: '€320', currency: 'EUR' },
  { id: '3', name: 'Mike Ross',  initials: 'MR', trusted: false, currency: 'USDT' },
];

const CURRENCIES: Record<TransferCurrency, { label: string; short: string; icon: string; placeholder: string }> = {
  EUR:      { label: 'Евро',          short: 'EUR',      icon: '€', placeholder: 'Email, телефон или IBAN' },
  USD:      { label: 'Доллар',        short: 'USD',      icon: '$', placeholder: 'Email, телефон или реквизиты' },
  USDT:     { label: 'USDT ERC-20',   short: 'USDT',     icon: '₮', placeholder: '0x…' },
  ETH:      { label: 'Ethereum',      short: 'ETH',      icon: 'Ξ', placeholder: '0x…' },
  BTC:      { label: 'Bitcoin',       short: 'BTC',      icon: '₿', placeholder: 'bc1… или 1…' },
  SOL:      { label: 'Solana',        short: 'SOL',      icon: '◎', placeholder: 'Solana address' },
  TON:      { label: 'TON',           short: 'TON',      icon: '◆', placeholder: 'EQ… или UQ…' },
  TRC20:    { label: 'USDT TRC-20',   short: 'TRC20',    icon: '₮', placeholder: 'T…' },
  USDT_TON: { label: 'USDT TON',      short: 'USDT TON', icon: '₮', placeholder: 'EQ… или UQ…' },
};

const CURRENCY_ORDER: TransferCurrency[] = ['EUR', 'USD', 'USDT', 'ETH', 'BTC', 'SOL', 'TON', 'TRC20', 'USDT_TON'];
const CRYPTO_CURRENCIES = new Set<TransferCurrency>(['USDT', 'ETH', 'BTC', 'SOL', 'TON', 'TRC20', 'USDT_TON']);

type SendStep = 'contacts' | 'recipient' | 'amount' | 'confirm' | 'done';

interface SendScreenProps {
  onAvatarState?: (state: 'idle' | 'talking' | 'thinking') => void;
  onSendCryptoTransfer?: (draft: {
    coin: CryptoCoin;
    address: string;
    amount: string;
    recipientName: string;
    neuroId?: string;
  }) => void;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  return letters || '+';
}

function currencySymbol(currency: TransferCurrency): string {
  return CURRENCIES[currency].icon;
}

function isCrypto(currency: TransferCurrency): boolean {
  return CRYPTO_CURRENCIES.has(currency);
}

function loadSavedContacts(): Contact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedContacts(contacts: Contact[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export const SendScreen: React.FC<SendScreenProps> = ({ onAvatarState, onSendCryptoTransfer }) => {
  const { isDemo } = useAuth();
  const [step, setStep] = useState<SendStep>('contacts');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [savedContacts, setSavedContacts] = useState<Contact[]>([]);
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [currency, setCurrency] = useState<TransferCurrency>('USDT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [resolvedNeuroId, setResolvedNeuroId] = useState('');
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    setSavedContacts(loadSavedContacts());
  }, []);

  const contacts = useMemo(() => {
    const base = isDemo ? DEMO_CONTACTS : [];
    return [...savedContacts, ...base.filter((demo) => !savedContacts.some((c) => c.id === demo.id))];
  }, [isDemo, savedContacts]);

  const selectedCurrency = selected?.currency ?? currency;
  const selectedMeta = CURRENCIES[selectedCurrency];
  const amountNum = parseFloat(amount) || 0;
  const recipientInput = recipientAddress.trim();
  const canSaveRecipient =
    recipientName.trim().length >= 2 &&
    (!isCrypto(currency) || (isNeuroId(recipientInput) ? Boolean(resolvedNeuroId) : recipientInput.length >= 8));

  const resetDraft = () => {
    setRecipientName('');
    setRecipientAddress('');
    setCurrency('USDT');
    setCopiedInvite(false);
    setLookupError('');
    setResolvedNeuroId('');
    setSendError('');
  };

  const handleSelectContact = (contact: Contact) => {
    setSelected(contact);
    setCurrency(contact.currency ?? 'EUR');
    setRecipientAddress(contact.address ?? '');
    onAvatarState?.('thinking');
    setTimeout(() => {
      onAvatarState?.('idle');
      setStep('amount');
    }, 400);
  };

  const handleNewRecipient = () => {
    setSelected(null);
    resetDraft();
    setStep('recipient');
  };

  const handleSaveRecipient = () => {
    if (!canSaveRecipient) return;

    const contact: Contact = {
      id: resolvedNeuroId ? `neuro-${resolvedNeuroId}` : `local-${Date.now()}`,
      name: recipientName.trim(),
      initials: initialsFor(recipientName),
      trusted: Boolean(resolvedNeuroId),
      currency,
      address: recipientAddress.trim(),
    };

    const next = [contact, ...savedContacts];
    setSavedContacts(next);
    persistSavedContacts(next);
    setSelected(contact);
    setStep('amount');
  };

  const handleResolveNeuroId = async () => {
    const neuroId = normalizeNeuroId(recipientAddress);
    if (!isNeuroId(neuroId)) return;

    setLookupLoading(true);
    setLookupError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Войди в аккаунт, чтобы искать NeuroID.');

      const res = await fetch(`/api/neuro-id/resolve?neuro_id=${encodeURIComponent(neuroId)}&coin=${encodeURIComponent(currency)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'NeuroID не найден.');

      setRecipientName(json.display_name || json.neuro_id);
      setRecipientAddress(json.address);
      setResolvedNeuroId(json.neuro_id);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Не удалось найти NeuroID.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleInvite = async () => {
    const text = `Присоединяйся к NeuroWallet: ${INVITE_URL}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NeuroWallet', text, url: INVITE_URL });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      setCopiedInvite(false);
    }
  };

  const handleSend = () => {
    setSendError('');
    if (selected && isCrypto(selectedCurrency)) {
      if (!selected.address) {
        setSendError('Для крипто-перевода нужен адрес получателя или найденный NeuroID.');
        return;
      }
      onSendCryptoTransfer?.({
        coin: selectedCurrency as CryptoCoin,
        address: selected.address,
        amount,
        recipientName: selected.name,
        neuroId: selected.id.startsWith('neuro-') ? selected.id.replace('neuro-', '') : undefined,
      });
      return;
    }

    setSendError('Фиатные внутренние переводы требуют отдельного custodial ledger. Сейчас доступна реальная отправка крипты.');
  };

  const handleDemoDone = () => {
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
          <p className="text-white text-xl font-bold">
            {amountNum.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {selectedCurrency} отправлено
          </p>
          <p className="text-[#3A6045] text-sm mt-1">{selected?.name} • только что</p>
        </div>
        <div
          className="w-full rounded-2xl p-4 text-left"
          style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">Нейра</p>
          <p className="text-white text-sm">
            Получатель сохранён в адресной книге. Для реальной отправки крипты следующий шаг — подтверждение адреса и подпись транзакции.
          </p>
        </div>
        <button
          onClick={() => { setStep('contacts'); setAmount(''); setNote(''); setSelected(null); resetDraft(); }}
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

      {step === 'contacts' && (
        <div className="flex flex-col gap-3">
          {contacts.length > 0 && (
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider">Получатели</p>
          )}
          {contacts.map((contact) => {
            const meta = CURRENCIES[contact.currency ?? 'EUR'];
            return (
              <button
                key={contact.id}
                onClick={() => handleSelectContact(contact)}
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
                style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
                  style={{ background: contact.trusted ? 'rgba(0,255,127,0.12)' : '#101f14', color: contact.trusted ? '#00FF7F' : '#fff' }}
                >
                  {contact.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{contact.name}</p>
                  <p className="text-[#3A6045] text-xs mt-0.5 truncate">
                    {contact.address ? contact.address : contact.lastAmount ? `Последний: ${contact.lastAmount}` : 'Новый контакт'} · {meta.short}
                  </p>
                </div>
                <span
                  className="text-[10px] font-semibold px-2 py-1 rounded-full"
                  style={{ background: contact.trusted ? 'rgba(0,255,127,0.1)' : 'rgba(245,158,11,0.08)', color: contact.trusted ? '#00FF7F' : '#f59e0b' }}
                >
                  {contact.trusted ? '✓ Доверенный' : 'Проверить'}
                </span>
              </button>
            );
          })}

          <button
            className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
            style={{ background: '#0D1A10', border: '1.5px solid rgba(0,255,127,0.16)' }}
            onClick={handleNewRecipient}
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(0,255,127,0.08)' }}>
              <span className="text-[#00FF7F] text-xl font-light">+</span>
            </div>
            <div className="flex-1">
              <p className="text-white text-sm font-medium">Добавить получателя</p>
              <p className="text-[#3A6045] text-xs mt-0.5">Имя, валюта и адрес</p>
            </div>
          </button>

          <button
            onClick={handleInvite}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.14)', color: '#00FF7F' }}
          >
            {copiedInvite ? 'Ссылка на приглашение готова' : 'Пригласить в NeuroWallet'}
          </button>
        </div>
      )}

      {step === 'recipient' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('contacts')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Назад
          </button>

          <div>
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">Имя получателя</p>
            <input
              type="text"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Например, Максим / Binance / Алексей"
              className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)', caretColor: '#00FF7F' }}
              autoFocus
            />
          </div>

          <div>
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">Валюта</p>
            <div className="grid grid-cols-3 gap-2">
              {CURRENCY_ORDER.map((item) => {
                const meta = CURRENCIES[item];
                const active = currency === item;
                return (
                  <button
                    key={item}
                    onClick={() => { setCurrency(item); setRecipientAddress(''); setResolvedNeuroId(''); setLookupError(''); }}
                    className="py-3 rounded-2xl flex flex-col items-center gap-1 transition-all active:scale-95"
                    style={{
                      background: active ? 'rgba(0,255,127,0.1)' : '#0D1A10',
                      border: `1px solid ${active ? 'rgba(0,255,127,0.35)' : 'rgba(0,255,127,0.08)'}`,
                      color: active ? '#00FF7F' : '#3A6045',
                    }}
                  >
                    <span className="text-base font-bold">{meta.icon}</span>
                    <span className="text-[10px] font-semibold">{meta.short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">
              {isCrypto(currency) ? 'NeuroID или адрес кошелька' : 'Реквизиты или контакт'}
            </p>
            <input
              type="text"
              value={recipientAddress}
              onChange={(event) => { setRecipientAddress(event.target.value); setResolvedNeuroId(''); setLookupError(''); }}
              placeholder={isCrypto(currency) ? `nw-... или ${CURRENCIES[currency].placeholder}` : CURRENCIES[currency].placeholder}
              className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none font-mono"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)', caretColor: '#00FF7F' }}
            />
            {isCrypto(currency) && isNeuroId(recipientAddress) && !resolvedNeuroId && (
              <button
                type="button"
                onClick={handleResolveNeuroId}
                disabled={lookupLoading}
                className="mt-2 w-full py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                style={{ background: 'rgba(0,255,127,0.08)', border: '1px solid rgba(0,255,127,0.18)', color: '#00FF7F' }}
              >
                {lookupLoading ? 'Ищу NeuroID…' : `Найти ${normalizeNeuroId(recipientAddress)}`}
              </button>
            )}
            {resolvedNeuroId && (
              <p className="text-[#00FF7F] text-xs mt-2">NeuroID найден: {resolvedNeuroId}. Адрес подставлен для {CURRENCIES[currency].short}.</p>
            )}
            {lookupError && (
              <p className="text-xs mt-2" style={{ color: '#FF5252' }}>{lookupError}</p>
            )}
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.12)' }}>
            <p className="text-[#00FF7F] text-xs font-semibold mb-1.5">Нейра</p>
            <p className="text-white text-sm leading-relaxed">
              Можно вставить обычный адрес или NeuroID. Если это NeuroID, я найду адрес нужной сети и всё равно покажу его перед подписью транзакции.
            </p>
          </div>

          <button
            onClick={handleSaveRecipient}
            disabled={!canSaveRecipient}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            Сохранить и продолжить
          </button>

          <button
            onClick={handleInvite}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'transparent', border: '1px solid rgba(0,255,127,0.18)', color: '#00FF7F' }}
          >
            {copiedInvite ? 'Ссылка на приглашение готова' : 'Пригласить получателя в приложение'}
          </button>
        </div>
      )}

      {step === 'amount' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('contacts')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Назад
          </button>

          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs" style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F' }}>
              {selected.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">{selected.name}</p>
              <p className="text-[#3A6045] text-xs truncate">{selected.address || 'Без адреса'} · {selectedMeta.label}</p>
            </div>
          </div>

          <div className="text-center py-6">
            <p className="text-[#3A6045] text-xs mb-3">Сумма</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[#00FF7F] text-5xl font-bold">{currencySymbol(selectedCurrency)}</span>
              <input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
                className="text-white text-5xl font-bold bg-transparent outline-none w-40 text-center"
                style={{ caretColor: '#00FF7F' }}
                autoFocus
              />
            </div>
            <p className="text-[#3A6045] text-xs mt-2">{selectedMeta.short}</p>
          </div>

          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Заметка (необязательно)"
            className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
          />

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.12)' }}>
            <p className="text-[#00FF7F] text-xs font-semibold mb-1.5">Нейра</p>
            {selected.trusted ? (
              <p className="text-white text-sm">
                {selected.name} — доверенный контакт. {selected.lastAmount ? `Последний перевод: ${selected.lastAmount}.` : ''} Реквизиты совпадают.
              </p>
            ) : (
              <p className="text-white text-sm">
                ⚠️ Получатель новый. Проверь адрес вручную перед отправкой, особенно если это {selectedMeta.short}.
              </p>
            )}
          </div>

          <button
            onClick={() => setStep('confirm')}
            disabled={!amount || amountNum <= 0}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            Продолжить
          </button>
        </div>
      )}

      {step === 'confirm' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('amount')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Назад
          </button>

          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">Получатель</span>
              <span className="text-white text-sm font-medium text-right">{selected.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">Валюта</span>
              <span className="text-white text-sm font-medium">{selectedMeta.label}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">Сумма</span>
              <span className="text-[#00FF7F] text-sm font-bold">
                {amountNum.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {selectedMeta.short}
              </span>
            </div>
            {selected.address && (
              <div style={{ borderTop: '1px solid rgba(0,255,127,0.08)', paddingTop: '12px' }}>
                <p className="text-[#3A6045] text-xs mb-1">Адрес / реквизиты</p>
                <p className="text-white text-xs font-mono break-all">{selected.address}</p>
              </div>
            )}
            {note && (
              <div className="flex justify-between gap-4">
                <span className="text-[#3A6045] text-sm">Заметка</span>
                <span className="text-white text-sm text-right">{note}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">Проверка</span>
              <span className="text-sm font-semibold" style={{ color: selected.trusted ? '#00FF7F' : '#f59e0b' }}>
                {selected.trusted ? '✓ Верифицирован' : '⚠ Новый получатель'}
              </span>
            </div>
          </div>

          <button
            onClick={handleSend}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 20px rgba(0,255,127,0.3)' }}
          >
            {isCrypto(selectedCurrency) ? 'Перейти к подписи' : 'Подтвердить'}
          </button>
          {sendError && (
            <div className="rounded-2xl p-3" style={{ background: 'rgba(255,82,82,0.06)', border: '1px solid rgba(255,82,82,0.2)' }}>
              <p className="text-xs" style={{ color: '#FF5252' }}>{sendError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SendScreen;
