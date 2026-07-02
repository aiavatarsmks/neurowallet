import type { NextApiRequest, NextApiResponse } from 'next';
import bs58 from 'bs58';
import { createHash } from 'crypto';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

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
  chain:    'ETH' | 'SOL' | 'BTC' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';
  type:     'in' | 'out';
  amount:   number;   // in native units
  address:  string;   // counterparty
  hash:     string;   // tx hash / signature
  date:     string;   // ISO date string
  fee:      number;   // in native units
}

const TONCENTER = 'https://toncenter.com/api/v2';

const USDT_CONTRACT      = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID           = 'https://api.trongrid.io';

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

function tronHexToAddr(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const payload = Buffer.from(clean, 'hex');
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

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

// ─── TRX native (TronGrid) ───────────────────────────────────────────────────

async function fetchTrxTxs(address: string): Promise<TxRow[]> {
  try {
    const url =
      `${TRONGRID}/v1/accounts/${address}/transactions` +
      '?only_confirmed=true&limit=20&order_by=block_timestamp,desc';
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.data)) return [];

    const addr = address.toLowerCase();
    const rows: TxRow[] = [];
    for (const tx of data.data as Array<Record<string, unknown>>) {
      const contracts = ((tx.raw_data as Record<string, unknown> | undefined)?.contract ?? []) as Array<Record<string, unknown>>;
      for (const contract of contracts) {
        if (contract.type !== 'TransferContract') continue;
        const value = (contract.parameter as Record<string, unknown> | undefined)?.value as Record<string, unknown> | undefined;
        const ownerHex = value?.owner_address as string | undefined;
        const toHex = value?.to_address as string | undefined;
        const amountSun = Number(value?.amount ?? 0);
        if (!ownerHex || !toHex || amountSun <= 0) continue;

        const from = tronHexToAddr(ownerHex);
        const to = tronHexToAddr(toHex);
        const isOut = from.toLowerCase() === addr;
        if (!isOut && to.toLowerCase() !== addr) continue;

        rows.push({
          id:      `trx-${tx.txID as string}`,
          chain:   'TRX',
          type:    isOut ? 'out' : 'in',
          amount:  amountSun / 1e6,
          address: isOut ? to : from,
          hash:    tx.txID as string,
          date:    new Date((tx.block_timestamp as number) ?? Date.now()).toISOString(),
          fee:     0,
        });
      }
    }
    return rows;
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

// ─── TON native (TonCenter) ───────────────────────────────────────────────────

async function fetchTonTxs(address: string): Promise<TxRow[]> {
  try {
    const url = `${TONCENTER}/getTransactions?address=${encodeURIComponent(address)}&limit=20`;
    const res  = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error || !Array.isArray(data.result)) return [];

    const rows: TxRow[] = [];
    for (const tx of data.result) {
      const inMsg   = tx.in_msg   as Record<string, unknown> | undefined;
      const outMsgs = (tx.out_msgs as Array<Record<string, unknown>>) ?? [];

      const tonIn  = parseInt((inMsg?.value  as string) || '0', 10);
      const tonOut = outMsgs.reduce(
        (s: number, m: Record<string, unknown>) => s + parseInt((m.value as string) || '0', 10),
        0,
      );

      // Skip Jetton-related txs (they have tiny TON amounts just for gas)
      // Jetton transfers identified by msg_data containing op 0x0f8a7ea5
      const outBody = (outMsgs[0]?.msg_data as string) ?? '';
      if (outBody.startsWith('0f8a7ea5') || outBody.startsWith('te6')) {
        continue; // will appear in USDT TON history instead
      }

      const isOut  = outMsgs.length > 0 && tonOut > 0;
      const amount = (isOut ? tonOut : tonIn) / 1e9;
      if (amount <= 0) continue;

      const counterpart = isOut
        ? ((outMsgs[0]?.destination as string) || '')
        : ((inMsg?.source as string) || '');

      const txid = (tx.transaction_id as Record<string, string>)?.hash ?? '';

      rows.push({
        id:      `ton-${txid}`,
        chain:   'TON',
        type:    isOut ? 'out' : 'in',
        amount,
        address: counterpart,
        hash:    txid,
        date:    new Date((tx.utime as number) * 1000).toISOString(),
        fee:     0,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

// ─── USDT TON Jetton (tonapi.io) ──────────────────────────────────────────────

const USDT_TON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TONAPI = 'https://tonapi.io/v2';

async function fetchUsdtTonTxs(address: string): Promise<TxRow[]> {
  try {
    // tonapi.io: jetton transfer history for specific jetton
    const url = `${TONAPI}/accounts/${encodeURIComponent(address)}/jettons/history` +
      `?jetton=${encodeURIComponent(USDT_TON_MASTER)}&limit=20`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.events)) return [];

    const rows: TxRow[] = [];
    for (const event of data.events) {
      for (const action of (event.actions ?? [])) {
        if (action.type !== 'JettonTransfer' || action.status !== 'ok') continue;
        const jt = action.JettonTransfer;
        if (!jt) continue;

        // Only USDT (filter by jetton master address)
        const jettonAddr = (jt.jetton?.address as string ?? '').toLowerCase();
        const masterNorm = USDT_TON_MASTER.toLowerCase();
        if (jettonAddr && jettonAddr !== masterNorm) continue;

        const senderAddr    = (jt.sender?.address    as string) ?? '';
        const recipientAddr = (jt.recipient?.address as string) ?? '';
        const isOut = senderAddr.toLowerCase() === address.toLowerCase();
        const amount = Number(jt.amount ?? 0) / 1e6; // 6 decimals
        if (amount <= 0) continue;

        const txHash = (event.event_id as string) ?? '';

        rows.push({
          id:      `usdt-ton-${txHash}`,
          chain:   'USDT_TON',
          type:    isOut ? 'out' : 'in',
          amount,
          address: isOut ? recipientAddr : senderAddr,
          hash:    txHash,
          date:    new Date((event.timestamp as number) * 1000).toISOString(),
          fee:     0,
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// Strict per-chain address formats. Addresses are interpolated into upstream
// API URLs, so anything outside these shapes is rejected up front (also
// prevents query-parameter injection into explorer requests).
const ADDRESS_FORMATS: Record<string, RegExp> = {
  eth:  /^0x[a-fA-F0-9]{40}$/,
  sol:  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  btc:  /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ton:  /^([A-Za-z0-9_-]{48}|-?\d+:[a-fA-F0-9]{64})$/,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!checkRateLimit(`tx-history:${auth.user.id}`, 30)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { eth, sol, btc, tron, ton } = req.query as Record<string, string>;

  for (const [chain, value] of Object.entries({ eth, sol, btc, tron, ton })) {
    if (value !== undefined && !ADDRESS_FORMATS[chain].test(value)) {
      return res.status(400).json({ error: `Invalid ${chain} address` });
    }
  }

  try {
    await writeAuditLog(
      auth.user.id,
      'tx_history_requested',
      { chains: Object.entries({ eth, sol, btc, tron, ton }).filter(([, v]) => v).map(([k]) => k) },
      req,
    );

    const [ethTxs, usdtTxs, trxTxs, trc20Txs, solTxs, btcTxs, tonTxs, usdtTonTxs] = await Promise.allSettled([
      eth  ? fetchEthTxs(eth)        : Promise.resolve([]),
      eth  ? fetchUsdtTxs(eth)       : Promise.resolve([]),
      tron ? fetchTrxTxs(tron)       : Promise.resolve([]),
      tron ? fetchTrc20Txs(tron)     : Promise.resolve([]),
      sol  ? fetchSolTxs(sol)        : Promise.resolve([]),
      btc  ? fetchBtcTxs(btc)        : Promise.resolve([]),
      ton  ? fetchTonTxs(ton)        : Promise.resolve([]),
      ton  ? fetchUsdtTonTxs(ton)    : Promise.resolve([]),
    ]);

    const all: TxRow[] = [
      ...(ethTxs.status      === 'fulfilled' ? ethTxs.value      : []),
      ...(usdtTxs.status     === 'fulfilled' ? usdtTxs.value     : []),
      ...(trxTxs.status      === 'fulfilled' ? trxTxs.value      : []),
      ...(trc20Txs.status    === 'fulfilled' ? trc20Txs.value    : []),
      ...(solTxs.status      === 'fulfilled' ? solTxs.value      : []),
      ...(btcTxs.status      === 'fulfilled' ? btcTxs.value      : []),
      ...(tonTxs.status      === 'fulfilled' ? tonTxs.value      : []),
      ...(usdtTonTxs.status  === 'fulfilled' ? usdtTonTxs.value  : []),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return res.status(200).json({ transactions: all });
  } catch (err) {
    console.error('tx-history error', err);
    return res.status(200).json({ transactions: [] });
  }
}
