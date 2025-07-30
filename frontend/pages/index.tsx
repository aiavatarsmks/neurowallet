import Link from 'next/link';

/**
 * Home page that directs the user to the wallet overview.
 */
export default function Home() {
  return (
    <main className="flex items-center justify-center h-screen bg-gray-100">
      <div className="text-center p-8 bg-white rounded shadow">
        <h1 className="text-2xl font-semibold mb-4">NeuroWallet</h1>
        <p className="mb-4">Welcome to NeuroWallet. Navigate to your wallet overview.</p>
        <Link href="/wallet" className="text-blue-600 underline">
          Go to Wallet Overview
        </Link>
      </div>
    </main>
  );
}