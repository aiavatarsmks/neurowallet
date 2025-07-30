import React, { useEffect, useState } from 'react';

export interface Transaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: string;
}

/**
 * A simple transaction history component that fetches mock transactions from
 * the backend. This implementation is intentionally naive and does not
 * handle loading or error states for brevity.
 */
export const TxHistory: React.FC = () => {
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    // Fetch mock transactions from backend. Assumes backend is running on
    // localhost:3001 by default; adjust the URL if your backend uses a
    // different port or is proxied via Next.js rewrites.
    fetch('http://localhost:3001/api/tx/mock')
      .then((res) => res.json())
      .then((data) => {
        setTxs(data);
      })
      .catch(() => {
        // ignore errors in skeleton
      });
  }, []);

  return (
    <div className="p-4 bg-white rounded shadow mt-4">
      <h2 className="text-lg font-semibold mb-2">Recent Transactions</h2>
      {txs.length === 0 ? (
        <p className="text-gray-500">No transactions found.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {txs.map((tx) => (
            <li key={tx.id} className="py-2 flex justify-between">
              <span className="font-mono text-sm">{tx.id.slice(0, 8)}…</span>
              <span className="text-sm">{tx.amount} ETH</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};