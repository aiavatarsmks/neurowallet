import { Address, Cell } from '@ton/ton';

/**
 * Helpers for TON history parsing (pages/api/tx-history.ts).
 *
 * toncenter v2 getTransactions returns msg_data as an object
 * ({ '@type': 'msg.dataRaw', body: '<base64 BoC>' } | { '@type': 'msg.dataText', text }),
 * not a string. tonapi returns addresses in raw `0:<hex>` form, so string
 * comparison with friendly (EQ…/UQ…) addresses never matches.
 */

// Jetton-служебные op-коды: сам перевод, уведомление получателю, возврат излишка газа.
export const JETTON_OPS = new Set<number>([0x0f8a7ea5, 0x7362d09c, 0xd53276db]);

/** 32-bit op code of a toncenter v2 message, or null (no body / text comment / unparsable). */
export function tonMsgOp(msgData: unknown): number | null {
  if (!msgData || typeof msgData !== 'object') return null;
  const d = msgData as Record<string, unknown>;
  if (d['@type'] !== 'msg.dataRaw' || typeof d.body !== 'string' || !d.body) return null;
  try {
    const slice = Cell.fromBase64(d.body).beginParse();
    if (slice.remainingBits < 32) return null;
    return slice.loadUint(32);
  } catch {
    return null;
  }
}

export function isJettonServiceMsg(msgData: unknown): boolean {
  const op = tonMsgOp(msgData);
  return op !== null && JETTON_OPS.has(op);
}

/** Compare TON addresses in any form (raw 0:hex, EQ…, UQ…). */
export function sameTonAddress(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

/** Friendly non-bounceable form for display; falls back to input. */
export function toFriendlyTon(addr: string): string {
  try {
    return Address.parse(addr).toString({ bounceable: false });
  } catch {
    return addr;
  }
}
