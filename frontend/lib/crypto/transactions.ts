/**
 * lib/crypto/transactions.ts
 * Fee estimation and transaction broadcasting for ETH and SOL.
 * Private keys never leave the browser — keystores decrypted in-memory only.
 */

import { ethers } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import {
  fetchUTXOs,
  getBtcFeeRate,
  selectUTXOs,
  buildSignedTx,
  broadcastBtcTx,
  isValidBtcAddress as _isValidBtcAddress,
} from './btc-tx';

const ETH_RPC = 'https://cloudflare-eth.com';
const SOL_RPC = 'https://api.mainnet-beta.solana.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EthFeeEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  feeEth:   number;
  feeEur:   number;
}

// ─── ETH fee estimation ───────────────────────────────────────────────────────

export async function estimateEthFee(
  toAddress: string,
  amountEth: number,
): Promise<EthFeeEstimate> {
  const provider  = new ethers.JsonRpcProvider(ETH_RPC);
  const value     = ethers.parseEther(String(amountEth));
  const [feeData, gasLimit] = await Promise.all([
    provider.getFeeData(),
    provider.estimateGas({ to: toAddress, value }),
  ]);
  const gasPrice = feeData.gasPrice ?? BigInt(20e9);
  const feeWei   = gasLimit * gasPrice;
  const feeEth   = parseFloat(ethers.formatEther(feeWei));

  let feeEur = feeEth * 2800;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
    const { ethereum } = await res.json();
    feeEur = feeEth * (ethereum?.eur ?? 2800);
  } catch { /* use fallback */ }

  return { gasLimit, gasPrice, feeEth, feeEur };
}

// ─── Send ETH ─────────────────────────────────────────────────────────────────

export async function sendEth(
  keystoreJson: string,
  password: string,
  toAddress: string,
  amountEth: number,
): Promise<string> {
  const wallet    = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  const provider  = new ethers.JsonRpcProvider(ETH_RPC);
  const connected = wallet.connect(provider);

  const tx = await connected.sendTransaction({
    to:    toAddress,
    value: ethers.parseEther(String(amountEth)),
  });

  await tx.wait();
  return tx.hash;
}

// ─── Send SOL ─────────────────────────────────────────────────────────────────
//
// SOL private key is stored as XOR with ETH private key (wallet_sol_xor).
// To send: decrypt ETH keystore → get ETH privkey → XOR with solXorHex → SOL privkey.
// This means one password unlocks both chains.

async function getSolanaBlockhash(): Promise<string> {
  const res = await fetch(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'finalized' }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('Solana RPC: ' + data.error.message);
  return data.result.value.blockhash as string;
}

/**
 * Build a legacy Solana message for a SOL transfer (SystemProgram.transfer).
 * Layout:
 *   header(3) | acct_count(1) | from(32) | to(32) | systemProg(32) |
 *   blockhash(32) | instr_count(1) | prog_idx(1) | acct_indices(3) |
 *   data_len(1) | instr_type_u32_le(4) | lamports_u64_le(8)
 */
function buildSolMessage(
  fromPubkey:      Uint8Array,
  toPubkey:        Uint8Array,
  lamports:        bigint,
  recentBlockhash: Uint8Array,
): Uint8Array {
  const systemProgram = new Uint8Array(32); // all zeros = 11111...1 in base58

  // Transfer instruction data: [u32 LE: 2][u64 LE: lamports]
  const instrData = new Uint8Array(12);
  const dv = new DataView(instrData.buffer);
  dv.setUint32(0, 2, true);
  dv.setUint32(4, Number(lamports & 0xFFFFFFFFn), true);
  dv.setUint32(8, Number(lamports >> 32n), true);

  const parts: Uint8Array[] = [
    new Uint8Array([1, 0, 1]),    // header: 1 signer, 0 readonly-signed, 1 readonly-unsigned
    new Uint8Array([3]),          // account_count = 3
    fromPubkey,                   // index 0 — signer + writable
    toPubkey,                     // index 1 — writable
    systemProgram,                // index 2 — readonly unsigned
    recentBlockhash,              // recent blockhash (32 bytes)
    new Uint8Array([1]),          // instruction_count = 1
    new Uint8Array([2]),          // program_id_index = 2 (SystemProgram)
    new Uint8Array([2, 0, 1]),    // 2 account indices: from(0), to(1)
    new Uint8Array([12]),         // data_length = 12
    instrData,                    // Transfer instruction
  ];

  const total = parts.reduce((s, p) => s + p.length, 0);
  const msg   = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { msg.set(p, off); off += p.length; }
  return msg;
}

export async function sendSol(
  keystoreJson: string,
  solXorHex:   string,
  password:    string,
  toAddress:   string,
  amountSol:   number,
): Promise<string> {
  // 1. Decrypt ETH keystore → ETH private key
  const ethWallet    = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  const ethPrivBytes = ethers.getBytes(ethWallet.privateKey); // Uint8Array(32)

  // 2. Recover SOL private key via XOR
  const xorBytes  = new Uint8Array(solXorHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const solPrivKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    solPrivKey[i] = xorBytes[i] ^ ethPrivBytes[i];
  }

  // 3. Derive SOL public key and decode recipient
  const fromPubkey = ed25519.getPublicKey(solPrivKey);
  const toPubkey   = bs58.decode(toAddress);
  if (toPubkey.length !== 32) throw new Error('Неверный SOL-адрес получателя.');

  const lamports = BigInt(Math.round(amountSol * 1e9));
  if (lamports <= 0n) throw new Error('Сумма должна быть больше нуля.');

  // 4. Fetch recent blockhash
  const blockhash      = await getSolanaBlockhash();
  const blockhashBytes = bs58.decode(blockhash);

  // 5. Build message and sign
  const message   = buildSolMessage(fromPubkey, toPubkey, lamports, blockhashBytes);
  const signature = ed25519.sign(message, solPrivKey); // Uint8Array(64)

  // 6. Assemble: [num_sigs=1][signature 64 bytes][message]
  const tx = new Uint8Array(1 + 64 + message.length);
  tx[0] = 1;
  tx.set(signature, 1);
  tx.set(message, 65);

  // 7. Broadcast
  const txBase64 = btoa(String.fromCharCode(...tx));
  const res = await fetch(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'sendTransaction',
      params: [txBase64, { encoding: 'base64', preflightCommitment: 'finalized' }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Solana RPC error');

  // Return tx signature as base58 string (Solana explorer format)
  return bs58.encode(signature);
}

// ─── Send BTC ─────────────────────────────────────────────────────────────────
//
// BTC private key stored as XOR with ETH private key (wallet_btc_xor).
// Same single-password unlock pattern as SOL.

export async function sendBtc(
  keystoreJson: string,
  btcXorHex:   string,
  password:    string,
  toAddress:   string,
  amountBtc:   number,
  fromAddress: string, // our BTC address (for change output)
): Promise<string> {
  // 1. Recover BTC private key
  const ethWallet    = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  const ethPrivBytes = ethers.getBytes(ethWallet.privateKey);
  const xorBytes     = new Uint8Array(btcXorHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const btcPrivKey   = new Uint8Array(32);
  for (let i = 0; i < 32; i++) btcPrivKey[i] = xorBytes[i] ^ ethPrivBytes[i];

  const amountSat = BigInt(Math.round(amountBtc * 1e8));
  if (amountSat <= 546n) throw new Error('Сумма ниже минимума (546 sat / dust limit).');

  // 2. Fetch UTXOs and fee rate
  const [utxos, feeRate] = await Promise.all([fetchUTXOs(fromAddress), getBtcFeeRate()]);
  if (utxos.length === 0) throw new Error('Нет подтверждённых UTXO. Подожди подтверждения входящих транзакций.');

  // 3. Select UTXOs and calculate change
  const { utxos: selected, change } = selectUTXOs(utxos, amountSat, feeRate);

  // 4. Build and sign raw transaction
  const rawHex = buildSignedTx(btcPrivKey, selected, toAddress, fromAddress, amountSat, change);

  // 5. Broadcast
  const txid = await broadcastBtcTx(rawHex);
  return txid;
}

// ─── Validate addresses ───────────────────────────────────────────────────────

export function isValidEthAddress(addr: string): boolean {
  return ethers.isAddress(addr);
}

export function isValidSolAddress(addr: string): boolean {
  try {
    const bytes = bs58.decode(addr);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

export { _isValidBtcAddress as isValidBtcAddress };
