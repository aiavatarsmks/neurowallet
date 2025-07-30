import { BalanceCard } from '@/components/BalanceCard';
import { TransferButton } from '@/components/TransferButton';
import { TxHistory } from '@/components/TxHistory';

/**
 * Wallet overview page showing the user's balance, a transfer button, and a
 * history of past transactions. All components are placeholders.
 */
export default function WalletPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Wallet Overview</h1>
      <BalanceCard />
      <div className="flex justify-end mb-4">
        <TransferButton />
      </div>
      <TxHistory />
    </main>
  );
}