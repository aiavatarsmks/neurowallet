import { describe, it, expect, vi, afterEach } from 'vitest';
import { JsonRpcProvider, Network, Transaction, Wallet, keccak256, encryptKeystoreJson, isError, type JsonRpcPayload, type JsonRpcResult } from 'ethers';
import {
  createEthProvider,
  broadcastToBackends,
  isDeterministicChainError,
  ETH_RPC_URLS,
} from '@/lib/crypto/eth-provider';
import { BroadcastOutcomeUnknownError, isBroadcastOutcomeUnknown } from '@/lib/crypto/broadcast-error';

// ─── Mock JSON-RPC backend ────────────────────────────────────────────────────
// A real ethers JsonRpcProvider with only the HTTP layer (_send) replaced, so
// ethers' own error mapping (getRpcError) runs exactly as in production.

class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
type Handler = (method: string, params: unknown[]) => unknown;

class MockRpc extends JsonRpcProvider {
  readonly calls: string[] = [];
  readonly handler: Handler;
  constructor(handler: Handler) {
    const net = Network.from(1);
    super('http://mock.invalid', net, { staticNetwork: net, batchMaxCount: 1 });
    this.handler = handler;
  }
  override async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const list = Array.isArray(payload) ? payload : [payload];
    return list.map((p) => {
      this.calls.push(p.method);
      try {
        return { id: p.id, result: this.handler(p.method, p.params as unknown[]) };
      } catch (e) {
        if (e instanceof RpcError) return { id: p.id, error: { code: e.code, message: e.message } } as unknown as JsonRpcResult;
        throw e; // transport failure (network down, HTTP 5xx, timeout)
      }
    });
  }
}

const BLOCK = {
  hash: '0x' + '11'.repeat(32),
  parentHash: '0x' + '22'.repeat(32),
  number: '0x10',
  timestamp: '0x67000000',
  nonce: '0x0000000000000000',
  difficulty: '0x0',
  gasLimit: '0x1c9c380',
  gasUsed: '0x0',
  miner: '0x' + '00'.repeat(20),
  extraData: '0x',
  baseFeePerGas: '0x3b9aca00',
  transactions: [],
};

/** A healthy mainnet node; `over` replaces single methods. */
function node(over: Record<string, Handler> = {}): MockRpc {
  return new MockRpc((method, params) => {
    if (over[method]) return over[method](method, params);
    switch (method) {
      case 'eth_blockNumber': return '0x10';
      case 'eth_getBalance': return '0xde0b6b3a7640000'; // 1 ETH
      case 'eth_getTransactionCount': return '0x5';
      case 'eth_estimateGas': return '0x5208';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_getBlockByNumber': return BLOCK;
      case 'eth_getTransactionByHash': return null;
      case 'eth_sendRawTransaction': return keccak256(params[0] as string);
      default: throw new RpcError(-32601, `Method not found: ${method}`);
    }
  });
}

const down = (): never => { throw new Error('connect ECONNREFUSED'); };
const internal = (): never => { throw new RpcError(-32603, 'Internal error'); };

const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const TO = '0x000000000000000000000000000000000000dEaD';
const wallet = new Wallet('0x' + '01'.repeat(32));

async function signedTx(): Promise<string> {
  return wallet.signTransaction({
    to: TO, value: 1n, nonce: 5, chainId: 1n, gasLimit: 21000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, type: 2,
  });
}

// ─── Configuration ────────────────────────────────────────────────────────────

describe('eth-provider: configuration', () => {
  it('uses exactly the three RPC hosts allowed by the CSP (no cloudflare-eth)', () => {
    expect(ETH_RPC_URLS).toEqual(['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth']);
  });

  it('pins chainId 1 and never sends eth_chainId', async () => {
    const a = node();
    const b = node();
    const p = createEthProvider([a, b]);
    expect((await p.getNetwork()).chainId).toBe(1n);
    await p.getBalance(ADDR);
    expect([...a.calls, ...b.calls]).not.toContain('eth_chainId');
  });
});

// ─── Read failover ────────────────────────────────────────────────────────────

describe('eth-provider: read failover', () => {
  it('falls back to the next backend when the first answers -32603 (the cloudflare-eth failure)', async () => {
    const dead = node({ eth_getBalance: internal });
    const ok = node();
    const p = createEthProvider([dead, ok]);
    expect(await p.getBalance(ADDR)).toBe(10n ** 18n);
    expect(dead.calls).toContain('eth_getBalance');
    expect(ok.calls).toContain('eth_getBalance');
  });

  it('falls back on eth_call transport errors too (balanceOf stays readable)', async () => {
    const dead = node({ eth_call: internal });
    const ok = node({ eth_call: () => '0x' + (5_000_000n).toString(16).padStart(64, '0') });
    const p = createEthProvider([dead, ok]);
    expect(await p.call({ to: TO, data: '0x70a08231' })).toBe('0x' + (5_000_000n).toString(16).padStart(64, '0'));
  });

  it('skips a backend that is fully down (network error)', async () => {
    const dead = node({ eth_blockNumber: down, eth_getBalance: down });
    const ok = node();
    const p = createEthProvider([dead, ok]);
    expect(await p.getBalance(ADDR)).toBe(10n ** 18n);
  });

  it('does not retry a real revert on other backends', async () => {
    const reverting = node({ eth_call: () => { throw new RpcError(3, 'execution reverted'); } });
    const other = node();
    const p = createEthProvider([reverting, other]);
    await expect(p.call({ to: TO, data: '0x70a08231' })).rejects.toSatisfy((e) => isError(e, 'CALL_EXCEPTION'));
    expect(other.calls).not.toContain('eth_call');
  });

  it('rejects (never resolves 0) when every backend fails', async () => {
    const p = createEthProvider([node({ eth_getBalance: internal }), node({ eth_getBalance: internal })]);
    await expect(p.getBalance(ADDR)).rejects.toBeTruthy();
    expect(p.needsRebuild).toBe(true);
  });

  it('a 0 priority-fee estimate (publicnode/1rpc) falls back to the 1 gwei default tip', async () => {
    const p = createEthProvider([node({ eth_maxPriorityFeePerGas: () => '0x0' })]);
    const fee = await p.getFeeData();
    expect(fee.maxPriorityFeePerGas).toBe(1_000_000_000n);
    expect(fee.maxFeePerGas).toBe(2n * 1_000_000_000n + 1_000_000_000n); // 2 × baseFee + tip
    expect(p.needsRebuild).toBe(false);
  });

  it('a non-zero priority-fee estimate is used as is', async () => {
    const p = createEthProvider([node({ eth_maxPriorityFeePerGas: () => '0x77359400' })]); // 2 gwei
    expect((await p.getFeeData()).maxPriorityFeePerGas).toBe(2_000_000_000n);
  });

  it('classifies chain answers vs transport failures', () => {
    expect(isDeterministicChainError(Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }))).toBe(true);
    expect(isDeterministicChainError(Object.assign(new Error('x'), { code: 'NONCE_EXPIRED' }))).toBe(true);
    expect(isDeterministicChainError(Object.assign(new Error('x'), { code: 'SERVER_ERROR' }))).toBe(false);
    expect(isDeterministicChainError(Object.assign(new Error('missing revert data'), { code: 'CALL_EXCEPTION', data: null, info: { error: { message: 'Internal error' } } }))).toBe(false);
    expect(isDeterministicChainError(new Error('no runners?!'))).toBe(false);
  });
});

// ─── Broadcast semantics ──────────────────────────────────────────────────────

describe('eth-provider: broadcast', () => {
  it('resolves on the first acceptance; a lagging "already known" / "nonce too low" does not matter', async () => {
    const raw = await signedTx();
    const hash = Transaction.from(raw).hash;
    const backends = [
      node(),
      node({ eth_sendRawTransaction: () => { throw new RpcError(-32000, 'already known'); } }),
      node({ eth_sendRawTransaction: () => { throw new RpcError(-32000, 'nonce too low'); } }),
    ];
    expect(await broadcastToBackends(backends, raw)).toBe(hash);
  });

  it('"already known" counts as accepted even if the accepting backend never answered', async () => {
    const raw = await signedTx();
    const backends = [
      node({ eth_sendRawTransaction: down }),
      node({ eth_sendRawTransaction: () => { throw new RpcError(-32000, 'already known'); } }),
    ];
    expect(await broadcastToBackends(backends, raw)).toBe(Transaction.from(raw).hash);
  });

  it('"nonce too low" everywhere and nobody has the tx → the rejection surfaces', async () => {
    const raw = await signedTx();
    const nonceLow = () => { throw new RpcError(-32000, 'nonce too low: next nonce 6, tx nonce 5'); };
    const backends = [node({ eth_sendRawTransaction: nonceLow }), node({ eth_sendRawTransaction: nonceLow })];
    await expect(broadcastToBackends(backends, raw)).rejects.toSatisfy((e) => isError(e, 'NONCE_EXPIRED'));
  });

  it('"nonce too low" but a backend sees this exact tx by hash → accepted', async () => {
    const raw = await signedTx();
    const hash = Transaction.from(raw).hash!;
    const nonceLow = () => { throw new RpcError(-32000, 'nonce too low'); };
    const seen = node({
      eth_sendRawTransaction: down,
      eth_getTransactionByHash: () => ({
        hash, blockHash: null, blockNumber: null, transactionIndex: null, type: '0x2', nonce: '0x5',
        from: wallet.address, to: TO, value: '0x1', gas: '0x5208', input: '0x', chainId: '0x1',
        maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00', accessList: [],
        r: '0x' + '01'.repeat(32), s: '0x' + '02'.repeat(32), v: '0x0', yParity: '0x0',
      }),
    });
    const backends = [node({ eth_sendRawTransaction: nonceLow }), seen];
    expect(await broadcastToBackends(backends, raw)).toBe(hash);
  });

  it('a real rejection (insufficient funds) surfaces even when another backend is unreachable', async () => {
    const raw = await signedTx();
    const poor = () => { throw new RpcError(-32000, 'insufficient funds for gas * price + value'); };
    const backends = [node({ eth_sendRawTransaction: down }), node({ eth_sendRawTransaction: poor })];
    await expect(broadcastToBackends(backends, raw)).rejects.toSatisfy((e) => isError(e, 'INSUFFICIENT_FUNDS'));
  });

  it('a lagging node saying "insufficient funds" does not beat a backend that accepted', async () => {
    const raw = await signedTx();
    const poor = () => { throw new RpcError(-32000, 'insufficient funds for gas * price + value'); };
    expect(await broadcastToBackends([node({ eth_sendRawTransaction: poor }), node()], raw)).toBe(Transaction.from(raw).hash);
  });

  it('all backends unreachable and the tx is not found → BroadcastOutcomeUnknownError(keccak256(signed))', async () => {
    const raw = await signedTx();
    const err = await broadcastToBackends([node({ eth_sendRawTransaction: down })], raw).catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect(isBroadcastOutcomeUnknown(err)).toBe(true);
    expect(err.hash).toBe(keccak256(raw));
    expect(err.hash).toBe(Transaction.from(raw).hash);
  });

  it('Wallet.sendTransaction through the provider: chainId 1, pending nonce, hash right after broadcast', async () => {
    const backends = [node({ eth_sendRawTransaction: internal }), node()];
    const p = createEthProvider(backends);
    const tx = await wallet.connect(p).sendTransaction({ to: TO, value: 1n });
    const sent = backends.flatMap((b) => b.calls);
    expect(sent).toContain('eth_sendRawTransaction');
    expect(sent).not.toContain('eth_chainId');
    expect(tx.chainId).toBe(1n);
    expect(tx.nonce).toBe(5);
    expect(tx.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('an accepted broadcast is not failed by a read (stock ethers also fetches the block number)', async () => {
    const raw = await signedTx();
    const p = createEthProvider([node({ eth_blockNumber: down }), node({ eth_blockNumber: internal })]);
    const tx = await p.broadcastTransaction(raw);
    expect(tx.hash).toBe(Transaction.from(raw).hash);
  });
});

// ─── Lost broadcast answers: look up by hash, never invite a paid retry ───────

describe('eth-provider: broadcast outcome unknown', () => {
  const timeout = (): never => { throw Object.assign(new Error('request timeout'), { code: 'TIMEOUT' }); };
  const rateLimited = (): never => { throw Object.assign(new Error('bad response (status=429)'), { code: 'SERVER_ERROR' }); };

  /** A node that already holds this tx (relayed it, then its answer was lost). */
  function holder(raw: string, over: Record<string, Handler> = {}): MockRpc {
    const hash = Transaction.from(raw).hash!;
    return node({
      eth_getTransactionByHash: () => ({
        hash, blockHash: null, blockNumber: null, transactionIndex: null, type: '0x2', nonce: '0x5',
        from: wallet.address, to: TO, value: '0x1', gas: '0x5208', input: '0x', chainId: '0x1',
        maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00', accessList: [],
        r: '0x' + '01'.repeat(32), s: '0x' + '02'.repeat(32), v: '0x0', yParity: '0x0',
      }),
      ...over,
    });
  }

  it('one backend relayed, then every backend timed out or answered 429 → the lookup finds it → success', async () => {
    const raw = await signedTx();
    const backends = [
      holder(raw, { eth_sendRawTransaction: timeout }),
      node({ eth_sendRawTransaction: rateLimited }),
      node({ eth_sendRawTransaction: down }),
    ];
    expect(await broadcastToBackends(backends, raw)).toBe(Transaction.from(raw).hash);
    expect(backends.flatMap((b) => b.calls)).toContain('eth_getTransactionByHash');
  });

  it('timeouts / 429 / -32603 everywhere and the tx is nowhere → unknown, not an ordinary error', async () => {
    const raw = await signedTx();
    const backends = [
      node({ eth_sendRawTransaction: timeout }),
      node({ eth_sendRawTransaction: rateLimited }),
      node({ eth_sendRawTransaction: internal }),
    ];
    await expect(broadcastToBackends(backends, raw)).rejects.toMatchObject({
      name: 'BroadcastOutcomeUnknownError', hash: Transaction.from(raw).hash,
    });
  });

  it('the lookup itself fails everywhere → still unknown (never a plain error)', async () => {
    const raw = await signedTx();
    const backends = [node({ eth_sendRawTransaction: timeout, eth_getTransactionByHash: down })];
    await expect(broadcastToBackends(backends, raw)).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
  });

  it('"intrinsic gas too low" / "invalid sender" are definitive rejections, not unknown', async () => {
    const raw = await signedTx();
    for (const msg of ['intrinsic gas too low: have 20000, want 21000', 'invalid sender']) {
      const reject = () => { throw new RpcError(-32000, msg); };
      const err = await broadcastToBackends([node({ eth_sendRawTransaction: timeout }), node({ eth_sendRawTransaction: reject })], raw)
        .catch((e) => e);
      expect(isBroadcastOutcomeUnknown(err)).toBe(false);
      expect(JSON.stringify(err.error ?? err.info)).toContain(msg.split(':')[0]);
    }
  });

  it('insufficient funds from one node while another timed out but holds the tx → success (lookup wins)', async () => {
    const raw = await signedTx();
    const poor = () => { throw new RpcError(-32000, 'insufficient funds for gas * price + value'); };
    const backends = [holder(raw, { eth_sendRawTransaction: timeout }), node({ eth_sendRawTransaction: poor })];
    expect(await broadcastToBackends(backends, raw)).toBe(Transaction.from(raw).hash);
  });

  it('insufficient funds everywhere → the rejection, no lookup needed', async () => {
    const raw = await signedTx();
    const poor = () => { throw new RpcError(-32000, 'insufficient funds for gas * price + value'); };
    const backends = [node({ eth_sendRawTransaction: poor }), node({ eth_sendRawTransaction: poor })];
    await expect(broadcastToBackends(backends, raw)).rejects.toSatisfy((e) => isError(e, 'INSUFFICIENT_FUNDS'));
    expect(backends.flatMap((b) => b.calls)).not.toContain('eth_getTransactionByHash');
  });

  it('"nonce too low" + a timeout, tx not found by a node that answered → NONCE_EXPIRED (real conflict)', async () => {
    const raw = await signedTx();
    const nonceLow = () => { throw new RpcError(-32000, 'nonce too low'); };
    const backends = [node({ eth_sendRawTransaction: timeout }), node({ eth_sendRawTransaction: nonceLow })];
    await expect(broadcastToBackends(backends, raw)).rejects.toSatisfy((e) => isError(e, 'NONCE_EXPIRED'));
  });

  it('"nonce too low" but nobody could answer the lookup → unknown (the used nonce may be ours)', async () => {
    const raw = await signedTx();
    const nonceLow = () => { throw new RpcError(-32000, 'nonce too low'); };
    const backends = [
      node({ eth_sendRawTransaction: timeout, eth_getTransactionByHash: down }),
      node({ eth_sendRawTransaction: nonceLow, eth_getTransactionByHash: internal }),
    ];
    await expect(broadcastToBackends(backends, raw)).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
  });

  it('Wallet.sendTransaction / sendEth surface the unknown outcome with the hash of what was signed', async () => {
    const raws: string[] = [];
    const backend = node({ eth_sendRawTransaction: (_m, ps) => { raws.push(ps[0] as string); return timeout(); } });
    const p = createEthProvider([backend]);
    const err = await wallet.connect(p).sendTransaction({ to: TO, value: 1n }).catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect(raws).toHaveLength(1);
    expect(err.hash).toBe(keccak256(raws[0]));
  });
});

// ─── sendEth / sendUsdt use the shared provider and return the hash ──────────

describe('sendEth / sendUsdt', () => {
  afterEach(() => vi.resetModules());

  it('sendEth signs for chainId 1 and returns the hash without waiting for a receipt', async () => {
    const backend = node();
    vi.doMock('@/lib/crypto/eth-provider', async (orig) => {
      const actual = (await orig()) as typeof import('@/lib/crypto/eth-provider');
      const shared = actual.createEthProvider([backend]);
      return { ...actual, getEthProvider: () => shared };
    });
    const { sendEth } = await import('@/lib/crypto/transactions');
    const keystore = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, 'pw', { scrypt: { N: 16 } });
    const hash = await sendEth(keystore, 'pw', TO, 0.001);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(backend.calls).toContain('eth_sendRawTransaction');
    expect(backend.calls).not.toContain('eth_getTransactionReceipt');
  });

  it('sendUsdt calls transfer on the USDT contract through the shared provider', async () => {
    const raws: string[] = [];
    const backend = node({ eth_sendRawTransaction: (_m, ps) => { raws.push(ps[0] as string); return keccak256(ps[0] as string); } });
    vi.doMock('@/lib/crypto/eth-provider', async (orig) => {
      const actual = (await orig()) as typeof import('@/lib/crypto/eth-provider');
      const shared = actual.createEthProvider([backend]);
      return { ...actual, getEthProvider: () => shared };
    });
    const { sendUsdt } = await import('@/lib/crypto/transactions');
    const keystore = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, 'pw', { scrypt: { N: 16 } });
    const hash = await sendUsdt(keystore, 'pw', TO, 12.5);
    const tx = Transaction.from(raws[0]);
    expect(hash).toBe(tx.hash);
    expect(tx.to).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(tx.chainId).toBe(1n);
    expect(tx.data.startsWith('0xa9059cbb')).toBe(true); // transfer(address,uint256)
  });

  it('sendUsdt: a lost broadcast answer reaches the caller as BroadcastOutcomeUnknownError with the signed hash', async () => {
    const raws: string[] = [];
    const backend = node({ eth_sendRawTransaction: (_m, ps) => { raws.push(ps[0] as string); throw new Error('socket hang up'); } });
    vi.doMock('@/lib/crypto/eth-provider', async (orig) => {
      const actual = (await orig()) as typeof import('@/lib/crypto/eth-provider');
      const shared = actual.createEthProvider([backend]);
      return { ...actual, getEthProvider: () => shared };
    });
    const { sendUsdt } = await import('@/lib/crypto/transactions');
    const keystore = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, 'pw', { scrypt: { N: 16 } });
    const err = await sendUsdt(keystore, 'pw', TO, 12.5).catch((e) => e);
    expect(isBroadcastOutcomeUnknown(err)).toBe(true);
    expect(err.hash).toBe(Transaction.from(raws[0]).hash);
  });
});
