/**
 * lib/crypto/transactions.ts
 * Fee estimation and ETH transaction broadcasting.
 * SOL sending omitted — requires @solana/web3.js serialization (future milestone).
 * Private key never leaves the browser — keystore decrypted in-memory only.
 */

import { ethers } from 'ethers';

const ETH_RPC = 'https://cloudflare-eth.com';

export interface EthFeeEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  feeEth:   number;
  feeEur:   number;
}

// ─── Fee estimation ────────────────────────────────────────────────────────

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

  let feeEur = feeEth * 2800; // fallback
  try {
    const res    = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur');
    const { ethereum } = await res.json();
    feeEur = feeEth * (ethereum?.eur ?? 2800);
  } catch { /* use fallback */ }

  return { gasLimit, gasPrice, feeEth, feeEur };
}

// ─── Send ETH ─────────────────────────────────────────────────────────────

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

// ─── Validate addresses ───────────────────────────────────────────────────

export function isValidEthAddress(addr: string): boolean {
  return ethers.isAddress(addr);
}

export function isValidSolAddress(addr: string): boolean {
  // Base58 string of 32–44 chars; rough check sufficient for UX
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}
