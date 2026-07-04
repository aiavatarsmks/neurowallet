import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import { isNeuroId, normalizeNeuroId } from '@/lib/neuro-id';

type TransferCurrency = 'EUR' | 'USD' | 'USDT' | 'ETH' | 'BTC' | 'SOL' | 'TON' | 'TRX' | 'TRC20' | 'USDT_TON';
type CryptoCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

interface Contact {
  id: string;
  name: string;
  initials: string;
  trusted: boolean;
  lastAmount?: string;
  currency?: TransferCurrency;
  address?: string;
  favorite?: boolean;
  serverId?: string; // id строки в public.contacts (если синхронизирован)
}

const STORAGE_KEY = 'nw_recipients_v1';
const INVITE_BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || 'https://t.me/NeuroWallet_bot';

const DEMO_CONTACTS: Contact[] = [
  { id: '1', name: 'John Doe',   initials: 'JD', trusted: true,  lastAmount: '€150', currency: 'EUR' },
  { id: '2', name: 'Alice Kim',  initials: 'AK', trusted: true,  lastAmount: '€320', currency: 'EUR' },
  { id: '3', name: 'Mike Ross',  initials: 'MR', trusted: false, currency: 'USDT' },
];

const CURRENCY_ORDER: TransferCurrency[] = ['EUR', 'USD', 'TRC20', 'USDT', 'USDT_TON', 'ETH', 'BTC', 'SOL', 'TON', 'TRX'];
const CRYPTO_CURRENCIES = new Set<TransferCurrency>(['USDT', 'ETH', 'BTC', 'SOL', 'TON', 'TRX', 'TRC20', 'USDT_TON']);

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

function isCrypto(currency: TransferCurrency): boolean {
  return CRYPTO_CURRENCIES.has(currency);
}

/** Клавиатура: скрывать по тапу вне текстового поля (mobile WebView). */
function blurOnOutsideTap(e: React.PointerEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('input,textarea')) {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
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
  const { t } = useLanguage();
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

  const INVITE_TEXT = [
    t('sendInviteText'),
    '',
    `${t('sendOpenInTelegram')} ${INVITE_BOT_URL}`,
  ].join('\n');

  const CURRENCIES: Record<TransferCurrency, { label: string; short: string; icon: string; placeholder: string }> = {
    EUR:      { label: t('currencyEUR'),  short: 'EUR',      icon: '€', placeholder: t('currencyPlaceholderFiat1') },
    USD:      { label: t('currencyUSD'),  short: 'USD',      icon: '$', placeholder: t('currencyPlaceholderFiat2') },
    USDT:     { label: 'USDT ERC-20',     short: 'USDT ERC-20', icon: '₮', placeholder: '0x…' },
    ETH:      { label: 'Ethereum',        short: 'ETH',      icon: 'Ξ', placeholder: '0x…' },
    BTC:      { label: 'Bitcoin',         short: 'BTC',      icon: '₿', placeholder: `bc1… ${t('authOr')} 1…` },
    SOL:      { label: 'Solana',          short: 'SOL',      icon: '◎', placeholder: 'Solana address' },
    TON:      { label: 'TON',             short: 'TON',      icon: '◆', placeholder: `EQ… ${t('authOr')} UQ…` },
    TRX:      { label: 'TRON',            short: 'TRX',      icon: '◆', placeholder: 'T…' },
    TRC20:    { label: 'USDT TRC-20',     short: 'USDT TRC-20', icon: '₮', placeholder: 'T…' },
    USDT_TON: { label: 'USDT TON',        short: 'USDT TON', icon: '₮', placeholder: `EQ… ${t('authOr')} UQ…` },
  };

  const currencySymbol = (curr: TransferCurrency): string => CURRENCIES[curr].icon;

  useEffect(() => {
    setSavedContacts(loadSavedContacts());
  }, []);

  // ── Серверная адресная книга (задача 1.4) ────────────────────────────────
  // Сервер — источник истины; локальные контакты доталкиваются на сервер
  // однократно (миграция localStorage → contacts). До миграции 0005 GET
  // отдаёт пусто, POST — 503: остаёмся на локальной копии, ничего не ломаем.
  useEffect(() => {
    if (isDemo || typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const r = await fetch('/api/contacts', { headers });
        const body = await r.json().catch(() => null);
        if (cancelled || !Array.isArray(body?.contacts)) return;

        const server: Contact[] = body.contacts.map((row: { id: string; name: string; coin: TransferCurrency; address: string; neuro_id: string | null; is_favorite: boolean }) => ({
          id: `srv-${row.id}`,
          serverId: row.id,
          name: row.name,
          initials: initialsFor(row.name),
          trusted: Boolean(row.neuro_id),
          currency: row.coin,
          address: row.address,
          favorite: row.is_favorite,
        }));

        const local = loadSavedContacts();
        const localOnly = local.filter(
          (c) => c.address && !server.some((s) => s.currency === c.currency && s.address === c.address),
        );
        // Однократный аплоад локальных контактов на сервер (fire-and-forget).
        for (const c of localOnly) {
          void fetch('/api/contacts', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: c.name, coin: c.currency, address: c.address, neuro_id: c.id.startsWith('neuro-') ? c.id.slice(6) : undefined }),
          }).catch(() => {});
        }

        const merged = [...server, ...localOnly];
        setSavedContacts(merged);
        persistSavedContacts(merged);
      } catch { /* локальная копия остаётся рабочей */ }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const contacts = useMemo(() => {
    const base = isDemo ? DEMO_CONTACTS : [];
    const merged = [...savedContacts, ...base.filter((demo) => !savedContacts.some((c) => c.id === demo.id))];
    // Favorites первыми, дальше — как были (свежие сверху).
    return merged.sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false));
  }, [isDemo, savedContacts]);

  /** Тоггл избранного: локально мгновенно, на сервер fire-and-forget. */
  const toggleFavorite = (contact: Contact) => {
    const nextFav = !(contact.favorite ?? false);
    setSavedContacts((prev) => {
      const next = prev.map((c) => (c.id === contact.id ? { ...c, favorite: nextFav } : c));
      persistSavedContacts(next);
      return next;
    });
    if (!contact.serverId || isDemo) return;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await fetch('/api/contacts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: contact.serverId, is_favorite: nextFav }),
        });
      } catch { /* не критично */ }
    })();
  };

  // Недавние получатели для выбранной криптовалюты (из tx_drafts sent).
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    if (step !== 'recipient' || isDemo || !isCrypto(currency)) { setRecents([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const r = await fetch(`/api/recipient-history?coin=${currency}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json().catch(() => null);
        if (!cancelled && Array.isArray(body?.addresses)) setRecents(body.addresses.slice(0, 5));
      } catch { /* пустые recents */ }
    })();
    return () => { cancelled = true; };
  }, [step, currency, isDemo]);

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

    // Синхронизация в серверную адресную книгу (fire-and-forget).
    if (!isDemo && isCrypto(currency) && contact.address) {
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token) return;
          await fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              name: contact.name,
              coin: currency,
              address: contact.address,
              neuro_id: resolvedNeuroId || undefined,
            }),
          });
        } catch { /* локальная копия уже сохранена */ }
      })();
    }
  };

  const handleResolveNeuroId = async () => {
    const neuroId = normalizeNeuroId(recipientAddress);
    if (!isNeuroId(neuroId)) return;

    setLookupLoading(true);
    setLookupError('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error(t('sendLoginRequiredNeuroId'));

      const res = await fetch(`/api/neuro-id/resolve?neuro_id=${encodeURIComponent(neuroId)}&coin=${encodeURIComponent(currency)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('sendNeuroIdNotFound'));

      setRecipientName(json.display_name || json.neuro_id);
      setRecipientAddress(json.address);
      setResolvedNeuroId(json.neuro_id);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : t('sendNeuroIdLookupFailed'));
    } finally {
      setLookupLoading(false);
    }
  };

  const handleInvite = async () => {
    try {
      if (navigator.share) {
        // INVITE_TEXT уже содержит ссылку. Отдельное поле url НЕ передаём:
        // Telegram share использует url и выбрасывает text → уходит голая
        // ссылка без пояснения (тот же баг, что чинили для paylink).
        await navigator.share({ text: INVITE_TEXT });
      } else {
        await navigator.clipboard.writeText(INVITE_TEXT);
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
        setSendError(t('sendCryptoAddressRequired'));
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

    setSendError(t('sendFiatError'));
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
            {t('sendDoneTitle').replace('{amt}', amountNum.toLocaleString('ru-RU', { maximumFractionDigits: 6 })).replace('{currency}', selectedCurrency)}
          </p>
          <p className="text-[#3A6045] text-sm mt-1">{t('sendDoneJustNow').replace('{name}', selected?.name ?? '')}</p>
        </div>
        <div
          className="w-full rounded-2xl p-4 text-left"
          style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">{t('navNeura')}</p>
          <p className="text-white text-sm">
            {t('sendDoneNeuraText')}
          </p>
        </div>
        <button
          onClick={() => { setStep('contacts'); setAmount(''); setNote(''); setSelected(null); resetDraft(); }}
          className="w-full py-4 rounded-2xl font-semibold text-sm"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          {t('sendNewTransfer')}
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 pt-2 flex flex-col gap-5" onPointerDown={blurOnOutsideTap}>
      <h2 className="text-white text-lg font-bold">{t('sendTitle')}</h2>

      {step === 'contacts' && (
        <div className="flex flex-col gap-3">
          {contacts.length > 0 && (
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider">{t('sendRecipientsLabel')}</p>
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
                    {contact.address ? contact.address : contact.lastAmount ? t('sendLastAmount').replace('{amt}', contact.lastAmount) : t('sendNewContact')} · {meta.short}
                  </p>
                </div>
                <span
                  className="text-[10px] font-semibold px-2 py-1 rounded-full"
                  style={{ background: contact.trusted ? 'rgba(0,255,127,0.1)' : 'rgba(245,158,11,0.08)', color: contact.trusted ? '#00FF7F' : '#f59e0b' }}
                >
                  {contact.trusted ? t('sendTrusted') : t('sendVerify')}
                </span>
                <span
                  role="button"
                  aria-label="favorite"
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(contact); }}
                  className="text-lg px-1 select-none"
                  style={{ color: contact.favorite ? '#F7931A' : '#3A6045' }}
                >
                  {contact.favorite ? '★' : '☆'}
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
              <p className="text-white text-sm font-medium">{t('sendAddRecipient')}</p>
              <p className="text-[#3A6045] text-xs mt-0.5">{t('sendAddRecipientDesc')}</p>
            </div>
          </button>

          <button
            onClick={handleInvite}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.14)', color: '#00FF7F' }}
          >
            {copiedInvite ? t('sendInviteLinkReady') : t('sendInviteToApp')}
          </button>
        </div>
      )}

      {step === 'recipient' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('contacts')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            {t('sendBack')}
          </button>

          <div>
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('sendRecipientNameLabel')}</p>
            <input
              type="text"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder={t('sendRecipientNamePlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
              className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)', caretColor: '#00FF7F' }}
            />
          </div>

          <div>
            <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('sendCurrencyLabel')}</p>
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
              {isCrypto(currency) ? t('sendNeuroIdOrAddress') : t('sendRequisitesOrContact')}
            </p>
            <input
              type="text"
              value={recipientAddress}
              onChange={(event) => { setRecipientAddress(event.target.value); setResolvedNeuroId(''); setLookupError(''); }}
              placeholder={isCrypto(currency) ? `nw-... ${t('authOr')} ${CURRENCIES[currency].placeholder}` : CURRENCIES[currency].placeholder}
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
                {lookupLoading ? t('sendSearchingNeuroId') : t('sendFindNeuroId').replace('{id}', normalizeNeuroId(recipientAddress))}
              </button>
            )}
            {resolvedNeuroId && (
              <p className="text-[#00FF7F] text-xs mt-2">{t('sendNeuroIdFound').replace('{id}', resolvedNeuroId).replace('{coin}', CURRENCIES[currency].short)}</p>
            )}
            {lookupError && (
              <p className="text-xs mt-2" style={{ color: '#FF5252' }}>{lookupError}</p>
            )}
            {recents.length > 0 && (
              <div className="mt-3">
                <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('sendRecentLabel')}</p>
                <div className="flex flex-col gap-1.5">
                  {recents.map((addr) => (
                    <button
                      key={addr}
                      type="button"
                      onClick={() => { setRecipientAddress(addr); setResolvedNeuroId(''); setLookupError(''); }}
                      className="text-left text-xs font-mono px-3 py-2 rounded-xl truncate transition-all active:scale-[0.98]"
                      style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)', color: '#7FBF9A' }}
                    >
                      {addr.length > 30 ? `${addr.slice(0, 16)}…${addr.slice(-10)}` : addr}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.12)' }}>
            <p className="text-[#00FF7F] text-xs font-semibold mb-1.5">{t('navNeura')}</p>
            <p className="text-white text-sm leading-relaxed">
              {t('sendNeuraHelperText')}
            </p>
          </div>

          <button
            onClick={handleSaveRecipient}
            disabled={!canSaveRecipient}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            {t('sendSaveContinue')}
          </button>

          <button
            onClick={handleInvite}
            className="w-full py-3.5 mb-8 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'transparent', border: '1px solid rgba(0,255,127,0.18)', color: '#00FF7F' }}
          >
            {copiedInvite ? t('sendInviteLinkReady') : t('sendInviteRecipient')}
          </button>
        </div>
      )}

      {step === 'amount' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('contacts')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            {t('sendBack')}
          </button>

          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs" style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F' }}>
              {selected.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium">{selected.name}</p>
              <p className="text-[#3A6045] text-xs truncate">{selected.address || t('sendNoAddress')} · {selectedMeta.label}</p>
            </div>
          </div>

          <div className="text-center py-6">
            <p className="text-[#3A6045] text-xs mb-3">{t('sendAmountLabel')}</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[#00FF7F] text-5xl font-bold">{currencySymbol(selectedCurrency)}</span>
              <input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0"
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
                className="text-white text-5xl font-bold bg-transparent outline-none w-40 text-center"
                style={{ caretColor: '#00FF7F' }}
              />
            </div>
            <p className="text-[#3A6045] text-xs mt-2">{selectedMeta.short}</p>
          </div>

          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('sendNotePlaceholder')}
            className="w-full rounded-2xl px-4 py-3.5 text-white text-sm bg-transparent outline-none"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
          />

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.12)' }}>
            <p className="text-[#00FF7F] text-xs font-semibold mb-1.5">{t('navNeura')}</p>
            {selected.trusted ? (
              <p className="text-white text-sm">
                {`${t('sendTrustedContactText').replace('{name}', selected.name)} ${selected.lastAmount ? t('sendLastTransferText').replace('{amt}', selected.lastAmount) : ''} ${t('sendDetailsMatch')}`.replace(/\s+/g, ' ').trim()}
              </p>
            ) : (
              <p className="text-white text-sm">
                {t('sendNewRecipientWarning').replace('{coin}', selectedMeta.short)}
              </p>
            )}
          </div>

          <button
            onClick={() => setStep('confirm')}
            disabled={!amount || amountNum <= 0}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            {t('sendContinue')}
          </button>
        </div>
      )}

      {step === 'confirm' && selected && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('amount')} className="flex items-center gap-2 text-[#3A6045] text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            {t('sendBack')}
          </button>

          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">{t('sendRecipientLabel')}</span>
              <span className="text-white text-sm font-medium text-right">{selected.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">{t('sendCurrencyLabel')}</span>
              <span className="text-white text-sm font-medium">{selectedMeta.label}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">{t('sendAmountLabel')}</span>
              <span className="text-[#00FF7F] text-sm font-bold">
                {amountNum.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {selectedMeta.short}
              </span>
            </div>
            {selected.address && (
              <div style={{ borderTop: '1px solid rgba(0,255,127,0.08)', paddingTop: '12px' }}>
                <p className="text-[#3A6045] text-xs mb-1">{t('sendAddressLabel')}</p>
                <p className="text-white text-xs font-mono break-all">{selected.address}</p>
              </div>
            )}
            {note && (
              <div className="flex justify-between gap-4">
                <span className="text-[#3A6045] text-sm">{t('sendNoteLabel')}</span>
                <span className="text-white text-sm text-right">{note}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-[#3A6045] text-sm">{t('sendVerificationLabel')}</span>
              <span className="text-sm font-semibold" style={{ color: selected.trusted ? '#00FF7F' : '#f59e0b' }}>
                {selected.trusted ? t('sendVerified') : t('sendNewRecipientBadge')}
              </span>
            </div>
          </div>

          <button
            onClick={handleSend}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 20px rgba(0,255,127,0.3)' }}
          >
            {isCrypto(selectedCurrency) ? t('sendProceedToSign') : t('sendConfirmBtn')}
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
