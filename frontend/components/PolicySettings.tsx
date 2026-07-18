/**
 * components/PolicySettings.tsx — permissions center for the Policy Engine (3.1).
 * Lists the user's policies (guardrails) and lets them add simple ones: a
 * per-transaction limit, a blocked recipient, or first-time-recipient confirm.
 * Flag-gated (policyEngineEnabled): renders nothing until the engine is enabled,
 * so it's inert in production until you flip the flag. Strings are local
 * bilingual (screen is behind a flag; can migrate to i18n later).
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { policyEngineEnabled } from '@/lib/policy-engine';
import { POLICY_AMOUNT_SCALE } from '@/lib/policy-check';
import { fetchPolicies, createPolicy, togglePolicy, deletePolicy, type PolicyRow } from '@/lib/policies-client';

type NewType = 'max_amount_per_tx' | 'blocked_recipients' | 'first_time_recipient_confirm';

const S = {
  ru: {
    title: 'Политики безопасности', add: 'Добавить', none: 'Пока нет политик',
    tLimit: 'Лимит на перевод', tBlock: 'Заблокировать адрес', tConfirm: 'Подтверждать новых получателей',
    amount: 'Сумма', address: 'Адрес', threshold: 'Порог суммы', save: 'Сохранить', del: 'Удалить',
    hint: 'Правила проверяют каждую отправку до подписи.',
  },
  en: {
    title: 'Security policies', add: 'Add', none: 'No policies yet',
    tLimit: 'Per-transfer limit', tBlock: 'Block a recipient', tConfirm: 'Confirm new recipients',
    amount: 'Amount', address: 'Address', threshold: 'Amount threshold', save: 'Save', del: 'Delete',
    hint: 'Rules check every send before signing.',
  },
};

const fmtScaled = (v: unknown): string => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? String(n / POLICY_AMOUNT_SCALE) : '?';
};

function summarize(p: PolicyRow, t: typeof S.ru): string {
  switch (p.type) {
    case 'max_amount_per_tx': return `${t.tLimit}: ≤ ${fmtScaled(p.rule.maxAmount)}${p.rule.asset ? ' ' + p.rule.asset : ''}`;
    case 'max_amount_per_day': return `Daily: ≤ ${fmtScaled(p.rule.maxAmount)}`;
    case 'blocked_recipients': return `${t.tBlock}: ${(p.rule.addresses as string[] | undefined)?.length ?? 0}`;
    case 'first_time_recipient_confirm': return `${t.tConfirm} ≥ ${fmtScaled(p.rule.thresholdAmount)}`;
    default: return p.type;
  }
}

export const PolicySettings: React.FC = () => {
  const { isDemo, user } = useAuth();
  const { lang } = useLanguage();
  const t = S[lang === 'en' ? 'en' : 'ru'];
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [type, setType] = useState<NewType>('max_amount_per_tx');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isDemo || !user || !policyEngineEnabled()) return;
    fetchPolicies().then(setRows);
  }, [isDemo, user]);

  if (isDemo || !user || !policyEngineEnabled()) return null;

  const reload = () => fetchPolicies().then(setRows);

  const add = async () => {
    if (busy) return;
    let rule: Record<string, unknown> | null = null;
    if (type === 'max_amount_per_tx') {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) rule = { maxAmount: String(Math.round(n * POLICY_AMOUNT_SCALE)) };
    } else if (type === 'blocked_recipients') {
      if (val.trim()) rule = { addresses: [val.trim()] };
    } else if (type === 'first_time_recipient_confirm') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) rule = { thresholdAmount: String(Math.round(n * POLICY_AMOUNT_SCALE)) };
    }
    if (!rule) return;
    setBusy(true);
    const id = await createPolicy(type, rule);
    setBusy(false);
    if (id) { setVal(''); reload(); }
  };

  const isAddr = type === 'blocked_recipients';

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
      <p className="text-white text-sm font-semibold">{t.title}</p>

      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <span className="text-[#3A6045] text-xs">{t.none}</span>}
        {rows.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(0,255,127,0.04)' }}>
            <span className="text-white text-xs flex-1" style={{ opacity: p.enabled ? 1 : 0.4 }}>{summarize(p, t)}</span>
            <button onClick={async () => { await togglePolicy(p.id, !p.enabled); reload(); }} className="text-[10px] font-semibold" style={{ color: p.enabled ? '#00FF7F' : '#3A6045' }}>
              {p.enabled ? 'ON' : 'OFF'}
            </button>
            <button onClick={async () => { await deletePolicy(p.id); reload(); }} className="text-[10px]" style={{ color: '#FF5252' }}>{t.del}</button>
          </div>
        ))}
      </div>

      <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

      <div className="flex flex-col gap-2">
        <select value={type} onChange={(e) => { setType(e.target.value as NewType); setVal(''); }}
          className="bg-transparent text-white text-xs rounded-lg px-2 py-1.5" style={{ border: '1px solid rgba(0,255,127,0.15)' }}>
          <option value="max_amount_per_tx" style={{ color: '#000' }}>{t.tLimit}</option>
          <option value="blocked_recipients" style={{ color: '#000' }}>{t.tBlock}</option>
          <option value="first_time_recipient_confirm" style={{ color: '#000' }}>{t.tConfirm}</option>
        </select>
        <div className="flex gap-2">
          <input value={val} onChange={(e) => setVal(e.target.value)}
            inputMode={isAddr ? 'text' : 'decimal'}
            placeholder={isAddr ? t.address : type === 'first_time_recipient_confirm' ? t.threshold : t.amount}
            className="flex-1 bg-transparent text-white text-xs rounded-lg px-2 py-1.5" style={{ border: '1px solid rgba(0,255,127,0.15)' }} />
          <button onClick={add} disabled={busy || !val.trim()} className="text-xs font-semibold px-3 rounded-lg"
            style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F', opacity: busy || !val.trim() ? 0.4 : 1 }}>{t.add}</button>
        </div>
        <span className="text-[#3A6045] text-[10px]">{t.hint}</span>
      </div>
    </div>
  );
};

export default PolicySettings;
