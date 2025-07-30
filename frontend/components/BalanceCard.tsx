import React from 'react';

/**
 * A placeholder component that would eventually display the user's current
 * wallet balance. In the MVP skeleton it simply renders static text.
 */
export const BalanceCard: React.FC = () => {
  return (
    <div className="p-4 bg-white rounded shadow mb-4">
      <h2 className="text-lg font-semibold mb-2">Balance</h2>
      <p className="text-gray-700">0.00 ETH</p>
    </div>
  );
};