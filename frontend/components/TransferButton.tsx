import React from 'react';

/**
 * A placeholder transfer button. In a production application this would
 * trigger a transfer flow via WalletConnect and Ethers.js. For the
 * skeleton it simply displays a disabled button.
 */
export const TransferButton: React.FC = () => {
  return (
    <button
      type="button"
      className="px-4 py-2 bg-blue-500 text-white rounded shadow disabled:opacity-50"
      disabled
    >
      Send / Receive (Coming Soon)
    </button>
  );
};