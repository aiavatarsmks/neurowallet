import React from 'react';

export interface Transaction {
  id: string;
  name: string;
  date: string;
  amount: number;
  currency: string;
  iconBg: string;
  iconChar: string;
  isCrypto?: boolean;
}

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: '1',  name: 'BTC получено',       date: 'Сегодня',  amount: +274.20,  currency: '€', iconBg: '#1a0d00', iconChar: '₿', isCrypto: true  },
  { id: '2',  name: 'Spotify',            date: 'Вчера',    amount: -9.99,    currency: '€', iconBg: '#1a1a1a', iconChar: 'S'                   },
  { id: '3',  name: 'Перевод от Марии',   date: 'Вчера',    amount: +500.00,  currency: '€', iconBg: '#0D2A18', iconChar: '↑'                   },
  { id: '4',  name: 'ETH отправлено',     date: '17 июн',   amount: -205.40,  currency: '€', iconBg: '#0D0D2A', iconChar: 'Ξ', isCrypto: true  },
  { id: '5',  name: 'Нестле Кофе',        date: '17 июн',   amount: -3.20,    currency: '€', iconBg: '#1a1a1a', iconChar: '☕'                   },
  { id: '6',  name: 'Amazon',             date: '16 июн',   amount: -50.00,   currency: '€', iconBg: '#1a1a1a', iconChar: 'A'                   },
  { id: '7',  name: 'USDT конвертация',   date: '15 июн',   amount: +50.00,   currency: '€', iconBg: '#0D1A0D', iconChar: '₮', isCrypto: true  },
];

interface TxHistoryProps {
  transactions?: Transaction[];
  limit?: number;
}

export const TxHistory: React.FC<TxHistoryProps> = ({
  transactions = MOCK_TRANSACTIONS,
  limit = 5,
}) => {
  const visible = transactions.slice(0, limit);

  if (visible.length === 0) {
    return <p className="text-[#3A6045] text-sm py-6 text-center">Нет транзакций</p>;
  }

  return (
    <div className="mt-1">
      <ul>
        {visible.map((tx) => {
          const positive = tx.amount >= 0;
          return (
            <li
              key={tx.id}
              className="flex items-center gap-3 py-3.5"
              style={{ borderBottom: '1px solid #0D1A10' }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{
                  backgroundColor: tx.iconBg,
                  color: tx.isCrypto
                    ? (tx.iconChar === '₿' ? '#F7931A' : tx.iconChar === 'Ξ' ? '#627EEA' : '#26A17B')
                    : positive ? '#00FF7F' : '#ffffff',
                  border: `1px solid ${positive ? 'rgba(0,255,127,0.2)' : 'rgba(255,255,255,0.07)'}`,
                }}
              >
                {tx.iconChar}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-white font-medium text-sm truncate">{tx.name}</p>
                  {tx.isCrypto && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(0,255,127,0.08)', color: '#3A6045' }}
                    >
                      CRYPTO
                    </span>
                  )}
                </div>
                <p className="text-[#3A6045] text-xs mt-0.5">{tx.date}</p>
              </div>

              <span
                className="text-sm font-semibold flex-shrink-0"
                style={{ color: positive ? '#00FF7F' : '#ffffff' }}
              >
                {positive ? '+' : '–'}{tx.currency}{Math.abs(tx.amount).toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default TxHistory;
