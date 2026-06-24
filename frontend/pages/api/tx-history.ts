import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * pages/api/tx-history.ts
 * Server-side proxy for transaction history.
 * - ETH: Etherscan API (ETHERSCAN_API_KEY env var, free tier: 5 req/s)
 * - SOL: Solana JSON-RPC (free, no key)
 * - BTC: Blockstream API (free, no key)
 */

const SOL_RPC        = 'https://api.mainnet-beta.solana.com';
const BLOCKSTREAM    = 'https://blockstream.info/api';

interface TxRow {
  id:       string;
  chain:    'ETH' | 'SOL' | 'BTC' | 'USDT' | 'TRC20';
  type:     'in' | 'out';
  amount:   number;   // in native units
  address:  string;   // counterparty
  hash:     string;   // tx hash / signature
  date:     string;   // ISO date string
  fee:      number;   // in native units
}

const USDT_CONTRACT      = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID           = 'https://api.trongrid.io';

// ─── ETH (Etherscan) ──────────────────────────────────────────────────────────

async function fetchEthTxs(address: string): Promise<TxRow[]> {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return [];

  const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${key}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== '1' || !Array.isArray(data.result)) return [];

  const addr = address.toLowerCase();
  return data.result
    .filter((tx: Record<string, string>) => tx.isError === '0')
    .slice(0, 15)
    .map((tx: Record<string, string>) => ({
      id:      tx.hash,
      chain:   'ETH' as const,
      type:    tx.from.toLowerCase() === addr ? 'out' : 'in',
      amount:  parseFloat(tx.value) / 1e18,
      address: tx.from.toLowerCase() === addr ? tx.to : tx.from,
      hash:    tx.hash,
      date:    new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      fee:     (parseInt(tx.gasUsed) * parseInt(tx.gasPrice)) / 1e18,
    }));
}

// ─── USDT ERC-20 (Etherscan tokentx) ─────────────────────────────────────────

async function fetchUsdtTxs(address: string): Promise<TxRow[]> {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return [];

  const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${USDT_CONTRACT}&address=${address}&page=1&offset=20&sort=desc&apikey=${key}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status !== '1' || !Array.isArray(data.result)) return [];

  const addr = address.toLowerCase();
  return data.result
    .slice(0, 15)
    .map((tx: Record<string, string>) => ({
      id:      `usdt-${tx.hash}`,
      chain:   'USDT' as const,
      type:    tx.from.toLowerCase() === addr ? 'out' : 'in',
      amount:  parseFloat(tx.value) / 1e6,   // USDT has 6 decimals
      address: tx.from.toLowerCase() === addr ? tx.to : tx.from,
      hash:    tx.hash,
      date:    new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      fee:     (parseInt(tx.gasUsed) * parseInt(tx.gasPrice)) / 1e18, // fee in ETH
    }));
}

// ─── USDT TRC-20 (TronGrid) ───────────────────────────────────────────────────

async function fetchTrc20Txs(address: string): Promise<TxRow[]> {
  try {
    const url =
      `${TRONGRID}/v1/accounts/${address}/transactions/trc20` +
      `?contract_address=${USDT_TRC20_CONTRACT}&limit=20&order_by=block_timestamp,desc`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.data)) return [];

    const addr = address.toLowerCase();
    return data.data.map((tx: Record<string, unknown>) => {
      const from  = (tx.from as string).toLowerCase();
      const to    = (tx.to   as string).toLowerCase();
      const isOut = from === addr;
      return {
        id:      `trc20-${tx.transaction_id as string}`,
        chain:   'TRC20' as const,
        type:    isOut ? 'out' : 'in',
        amount:  parseInt(tx.value as string, 10) / 1e6,
        address: isOut ? (tx.to as string) : (tx.from as string),
        hash:    tx.transaction_id as string,
        date:    new Date(tx.block_timestamp as number).toISOString(),
        fee:     0, // TRC-20 fees are in TRX, not tracked here
      };
    });
  } catch {
    return [];
  }
}

// ─── SOL (Solana JSON-RPC) ────────────────────────────────────────────────────

async function fetchSolTxs(address: string): Promise<TxRow[]> {
  // Get recent signatures
  const sigRes = await fetch(SOL_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method:  'getSignaturesForAddress',
      params:  [address, { limit: 15 }],
    }),
  });
  const sigData = await sigRes.json();
  if (!Array.isArray(sigData.result)) return [];

  const signatures: string[] = sigData.result
    .filter((s: Record<string, unknown>) => !s.err)
    .map((s: Record<string, string>) => s.signature);

  if (signatures.length === 0) return [];

  // Fetch transaction details in batch
  const txRes = await fetch(SOL_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      signatures.slice(0, 10).map((sig, i) => ({
        jsonrpc: '2.0', id: i + 1,
        method:  'getTransaction',
        params:  [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      })),
    ),
  });
  const txData = await txRes.json();
  const txs: TxRow[] = [];

  for (const resp of txData) {
    const tx = resp?.result;
    if (!tx || !tx.meta) continue;

    const accounts: string[] = tx.transaction?.message?.accountKeys?.map(
      (k: { pubkey?: string } | string) => (typeof k === 'string' ? k : k.pubkey ?? ''),
    ) ?? [];
    const myIdx = accounts.findIndex((a: string) => a === address);
    if (myIdx === -1) continue;

    const preBal:  number = tx.meta.preBalances?.[myIdx]  ?? 0;
    const postBal: number = tx.meta.postBalances?.[myIdx] ?? 0;
    const delta = (postBal - preBal) / 1e9; // in SOL
    const fee   = (tx.meta.fee ?? 0) / 1e9;

    if (Math.abs(delta) < 0.000001) continue; // skip dust

    // Try to find counterparty (first non-self account with opposite balance change)
    let counterparty = '';
    for (let i = 0; i < accounts.length; i++) {
      if (i === myIdx) continue;
      const d = ((tx.meta.postBalances[i] ?? 0) - (tx.meta.preBalances[i] ?? 0)) / 1e9;
      if (Math.abs(d) > 0.000001) { counterparty = accounts[i]; break; }
    }

    txs.push({
      id:      resp.id.toString(),
      chain:   'SOL',
      type:    delta > 0 ? 'in' : 'out',
      amount:  Math.abs(delta),
      address: counterparty,
      hash:    tx.transaction?.signatures?.[0] ?? '',
      date:    tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
      fee,
    });
  }

  return txs;
}

// ─── BTC (Blockstream) ────────────────────────────────────────────────────────

async function fetchBtcTxs(address: string): Promise<TxRow[]> {
  const res  = await fetch(`${BLOCKSTREAM}/address/${address}/txs`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.slice(0, 15).map((tx: Record<string, unknown>) => {
    // Sum inputs and outputs for our address
    const inputs  = (tx.vin  as Array<Record<string, unknown>>) ?? [];
    const outputs = (tx.vout as Array<Record<string, unknown>>) ?? [];

    let sent = 0;
    for (const inp of inputs) {
      const prevout = inp.prevout as Record<string, unknown> | undefined;
      if ((prevout?.scriptpubkey_address as string) === address) {
        sent += (prevout?.value as number) ?? 0;
      }
    }
    let received = 0;
    for (const out of outputs) {
      if ((out.scriptpubkey_address as string) === address) {
        received += (out.value as number) ?? 0;
      }
    }

    const netSat = received - sent;
    const status = tx.status as Record<string, unknown>;
    const date   = status?.block_time
      ? new Date((status.block_time as number) * 1000).toISOString()
      : new Date().toISOString();

    // Counterparty: first output not to our address
    let counterparty = '';
    for (const out of outputs) {
      if ((out.scriptpubkey_address as string) !== address) {
        counterparty = out.scriptpubkey_address as string;
        break;
      }
    }

    const fee = (tx.fee as number) ?? 0;

    return {
      id:      tx.txid as string,
      chain:   'BTC' as const,
      type:    netSat >= 0 ? 'in' : 'out',
      amount:  Math.abs(netSat) / 1e8,
      address: counterparty,
      hash:    tx.txid as string,
      date,
      fee:     fee / 1e8,
    };
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { eth, sol, btc, tron } = req.query as Record<string, string>;

  try {
    const [ethTxs, usdtTxs, trc20Txs, solTxs, btcTxs] = await Promise.allSettled([
      eth  ? fetchEthTxs(eth)    : Promise.resolve([]),
      eth  ? fetchUsdtTxs(eth)   : Promise.resolve([]),
      tron ? fetchTrc20Txs(tron) : Promise.resolve([]),
      sol  ? fetchSolTxs(sol)    : Promise.resolve([]),
      btc  ? fetchBtcTxs(btc)    : Promise.resolve([]),
    ]);

    const all: TxRow[] = [
      ...(ethTxs.status   === 'fulfilled' ? ethTxs.value   : []),
      ...(usdtTxs.status  === 'fulfilled' ? usdtTxs.value  : []),
      ...(trc20Txs.status === 'fulfilled' ? trc20Txs.value : []),
      ...(solTxs.status   === 'fulfilled' ? solTxs.value   : []),
      ...(btcTxs.status   === 'fulfilled' ? btcTxs.value   : []),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return res.status(200).json({ transactions: all });
  } catch (err) {
    console.error('tx-history error', err);
    return res.status(200).json({ transactions: [] });
  }
}
