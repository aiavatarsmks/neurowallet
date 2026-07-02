import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface TxRow {
  id:      string;
  chain:   'ETH' | 'SOL' | 'BTC' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';
  type:    'in' | 'out';
  amount:  number;
  address: string;
  hash:    string;
  date:    string;
  fee:     number;
}

const CHAIN_META = {
  ETH:      { icon: 'Ξ',  color: '#627EEA', label: 'ETH',      explorer: (h: string) => `https://etherscan.io/tx/${h}` },
  SOL:      { icon: '◎',  color: '#9945FF', label: 'SOL',      explorer: (h: string) => `https://solscan.io/tx/${h}` },
  BTC:      { icon: '₿',  color: '#F7931A', label: 'BTC',      explorer: (h: string) => `https://blockstream.info/tx/${h}` },
  USDT:     { icon: '₮',  color: '#26A17B', label: 'ERC-20',   explorer: (h: string) => `https://etherscan.io/tx/${h}` },
  TRX:      { icon: '◆',  color: '#EF0027', label: 'TRX',      explorer: (h: string) => `https://tronscan.org/#/transaction/${h}` },
  TRC20:    { icon: '₮',  color: '#EF0027', label: 'TRC-20',   explorer: (h: string) => `https://tronscan.org/#/transaction/${h}` },
  TON:      { icon: '💎', color: '#0098EA', label: 'TON',      explorer: (h: string) => `https://tonscan.org/tx/${h}` },
  USDT_TON: { icon: '₮',  color: '#0098EA', label: 'USDT TON', explorer: (h: string) => `https://tonscan.org/tx/${h}` },
};

const DEMO_TXS: TxRow[] = [
  {
    id: 'demo-btc-in',
    chain: 'BTC',
    type: 'in',
    amount: 0.0042,
    address: 'bc1qdemo9r8s7neuro5wallet3sample',
    hash: 'demo-btc-in',
    date: new Date(Date.now() - 35 * 60_000).toISOString(),
    fee: 0,
  },
  {
    id: 'demo-usdt-out',
    chain: 'USDT',
    type: 'out',
    amount: 75,
    address: '0xDemo4A65F7F3NeuroWalletSample',
    hash: 'demo-usdt-out',
    date: new Date(Date.now() - 4 * 3600_000).toISOString(),
    fee: 0.0008,
  },
  {
    id: 'demo-trx-out',
    chain: 'TRX',
    type: 'out',
    amount: 18.5,
    address: 'TDemoTronNeuroWalletSample9aP',
    hash: 'demo-trx-out',
    date: new Date(Date.now() - 26 * 3600_000).toISOString(),
    fee: 0.1,
  },
];

function formatDate(iso: string, t: (k: any) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000);
    if (h === 0) {
      const m = Math.floor(diff / 60_000);
      return m <= 1 ? t('txJustNow') : t('txMinAgo').replace('{m}', String(m));
    }
    return t('txHoursAgo').replace('{h}', String(h));
  }
  if (diff < 2 * 86400_000) return t('txYesterday');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function shortAddr(addr: string): string {
  if (!addr) return '—';
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-5)}` : addr;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const TxSkeleton = () => (
  <div className="flex flex-col gap-3 mt-1">
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid #0D1A10' }}>
        <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: '#0D1A10' }} />
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="h-3 rounded-full w-24" style={{ background: '#0D1A10' }} />
          <div className="h-2.5 rounded-full w-16" style={{ background: '#080C09' }} />
        </div>
        <div className="h-3 rounded-full w-14" style={{ background: '#0D1A10' }} />
      </div>
    ))}
  </div>
);

// ─── Component ────────────────────────────────────────────────────────────────

interface TxHistoryProps {
  limit?: number;
}

export const TxHistory: React.FC<TxHistoryProps> = ({ limit = 15 }) => {
  const { isDemo } = useAuth();
  const { t } = useLanguage();
  const [txs,     setTxs]     = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noWallet, setNoWallet] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      setTxs(DEMO_TXS.slice(0, limit));
      setNoWallet(false);
      setLoading(false);
      return;
    }

    const eth  = localStorage.getItem('wallet_eth_address');
    const sol  = localStorage.getItem('wallet_sol_address');
    const btc  = localStorage.getItem('wallet_btc_address');
    const tron = localStorage.getItem('wallet_tron_address');
    const ton  = localStorage.getItem('wallet_ton_address');

    if (!eth) {
      setNoWallet(true);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (eth)  params.set('eth',  eth);
    if (sol)  params.set('sol',  sol);
    if (btc)  params.set('btc',  btc);
    if (tron) params.set('tron', tron);
    if (ton)  params.set('ton',  ton);

    fetch(`/api/tx-history?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setTxs((data.transactions ?? []).slice(0, limit));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isDemo, limit]);

  if (loading) return <TxSkeleton />;

  if (noWallet) {
    return (
      <p className="text-[#3A6045] text-sm py-6 text-center">
        {t('txNoWallet')}
      </p>
    );
  }

  if (txs.length === 0) {
    return (
      <p className="text-[#3A6045] text-sm py-6 text-center">
        {t('txNoTransactions')}
      </p>
    );
  }

  return (
    <div className="mt-1">
      <ul>
        {txs.map((tx) => {
          const meta     = CHAIN_META[tx.chain];
          const positive = tx.type === 'in';
          const label    = positive
            ? t('txReceived').replace('{chain}', tx.chain)
            : t('txSent').replace('{chain}', tx.chain);

          return (
            <li
              key={tx.id}
              className="flex items-center gap-3 py-3.5"
              style={{ borderBottom: '1px solid #0D1A10' }}
            >
              {/* Icon */}
              <a
                href={meta.explorer(tx.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-opacity hover:opacity-70"
                  style={{
                    background: `${meta.color}1a`,
                    color:      meta.color,
                    border:     `1px solid ${meta.color}44`,
                  }}
                >
                  {meta.icon}
                </div>
              </a>

              {/* Label + counterparty */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-white font-medium text-sm truncate">{label}</p>
                  <span
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: `${meta.color}1a`, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-[#3A6045] text-xs mt-0.5">
                  {positive ? `${t('txFrom')} ` : `${t('txTo')} `}{shortAddr(tx.address)} · {formatDate(tx.date, t)}
                </p>
              </div>

              {/* Amount */}
              <span
                className="text-sm font-semibold flex-shrink-0"
                style={{ color: positive ? '#00FF7F' : '#ffffff' }}
              >
                {positive ? '+' : '–'}{tx.amount.toLocaleString('ru-RU', {
                  maximumFractionDigits: tx.chain === 'USDT' || tx.chain === 'TRC20' || tx.chain === 'USDT_TON' ? 2 : 6,
                })} {tx.chain === 'TRC20' ? 'USDT' : tx.chain === 'USDT_TON' ? 'USDT' : tx.chain}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// Legacy export for backward compat
export type Transaction = TxRow;

export default TxHistory;
