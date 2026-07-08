/**
 * lib/name-resolvers.ts — recipient name resolution (задача 2.6).
 *
 * ENS (.eth → ETH address) and TON DNS (.ton → TON address). Guards (по п.2):
 *  - deterministic: one name → one address, or null;
 *  - FAIL-CLOSED: any ambiguity / error / not-found / unparseable → null (the
 *    caller then treats the input as a literal address and validation fails);
 *  - the caller MUST show the resolved ADDRESS on review (user confirms the
 *    address, not the alias) and run it through the same risk engine + simulation.
 *
 * Hosts are in the CSP connect-src (cloudflare-eth.com, tonapi.io).
 */
import { ethers } from 'ethers';
import { Address } from '@ton/ton';

const ETH_RPC = 'https://cloudflare-eth.com';
const TON_DNS_API = 'https://tonapi.io/v2/dns';

export function looksLikeEnsName(s: string): boolean {
  return /^([a-z0-9-]+\.)+eth$/i.test(s.trim());
}
export function looksLikeTonDnsName(s: string): boolean {
  return /^([a-z0-9-]+\.)+ton$/i.test(s.trim());
}
export function isResolvableName(s: string): boolean {
  return looksLikeEnsName(s) || looksLikeTonDnsName(s);
}

/** Resolve an ENS .eth name → checksummed ETH address, or null (fail-closed). */
export async function resolveEns(name: string): Promise<string | null> {
  const n = name.trim().toLowerCase();
  if (!looksLikeEnsName(n)) return null;
  try {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const addr = await provider.resolveName(n);
    if (!addr || !ethers.isAddress(addr)) return null;
    return ethers.getAddress(addr); // checksummed
  } catch {
    return null;
  }
}

/** Resolve a .ton DNS name → friendly bounceable TON address, or null (fail-closed). */
export async function resolveTonDns(name: string): Promise<string | null> {
  const n = name.trim().toLowerCase();
  if (!looksLikeTonDnsName(n)) return null;
  try {
    const res = await fetch(`${TON_DNS_API}/${encodeURIComponent(n)}/resolve`);
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.wallet?.address; // tonapi returns raw "0:hex" on success
    if (typeof raw !== 'string' || !raw) return null; // {error:...} or missing → fail-closed
    // raw → friendly bounceable; any parse error is caught → null (fail-closed).
    return Address.parseRaw(raw).toString({ bounceable: true, urlSafe: true, testOnly: false });
  } catch {
    return null;
  }
}

export type ResolvableChain = 'eth' | 'ton';

/**
 * Resolve `input` to an address for the given chain family, or null. Only the
 * matching name type is resolved (ENS↔eth, .ton↔ton); a mismatched suffix (e.g.
 * a .eth name while sending TON) returns null → the send falls back to literal-
 * address validation, which will reject it. Fail-closed by construction.
 */
export async function resolveName(input: string, chain: ResolvableChain): Promise<string | null> {
  if (chain === 'eth') return resolveEns(input);
  if (chain === 'ton') return resolveTonDns(input);
  return null;
}
