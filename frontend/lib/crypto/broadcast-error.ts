/**
 * lib/crypto/broadcast-error.ts
 * Shared contract between the chain send functions and the send screen.
 *
 * A broadcast can fail at the transport level AFTER a node already accepted the
 * transaction (response lost, timeout, 5xx after relay). Showing that as an
 * ordinary error invites a retry, and a retry is a second, different transfer
 * (new nonce / blockhash / UTXOs / seqno). So when the outcome is unknown the
 * send functions throw this error with the hash that was known before
 * broadcast, and the UI shows the done screen in a "don't resend, checking"
 * state, polling the status by that hash.
 *
 * Throw it ONLY when the transaction was fully signed and handed to the
 * network and no endpoint gave a definitive answer. A definitive rejection
 * (invalid tx, insufficient funds, nonce too low without the tx being found)
 * stays a normal error.
 */

export class BroadcastOutcomeUnknownError extends Error {
  /** Chain hash / txid / signature as the status poller expects it (TON: 'ton:seqno:N'). */
  readonly hash: string;

  constructor(hash: string, message = 'Broadcast outcome unknown') {
    super(message);
    this.name = 'BroadcastOutcomeUnknownError';
    this.hash = hash;
  }
}

export function isBroadcastOutcomeUnknown(e: unknown): e is BroadcastOutcomeUnknownError {
  return e instanceof BroadcastOutcomeUnknownError
    || (!!e && typeof e === 'object' && (e as { name?: unknown }).name === 'BroadcastOutcomeUnknownError'
      && typeof (e as { hash?: unknown }).hash === 'string');
}
