import { msg } from "@qorechain/sdk";
import type { DeliveredTx } from "../chain/tx";
import type { ChainMessage } from "../signer/types";

/**
 * Autopay: a standing permission the owner signs once, on chain.
 *
 * It is a 1 uqor transfer from the owner to itself whose memo says
 *   fenestella-autopay:v1:on:<payee 0x…>:<max uqor per bill>:<until unix>
 * or, to turn it off,
 *   fenestella-autopay:v1:off:<payee 0x…>
 * The transaction is hybrid-signed, so only the owner's post-quantum key can
 * make one, and QoreX shows the memo before signing. The newest valid memo for
 * a payee wins. There is no server state: the agent reads it from the chain.
 *
 * Autopay does not widen anything. The vault still pays only approved payees
 * within the owner's limits, and the agent's AI still has to approve each
 * payment. Autopay only means the agent may do it without a fresh mandate.
 */
export const AUTOPAY_PREFIX = "fenestella-autopay:v1:";
/** Longest standing permission, in days. */
export const AUTOPAY_MAX_DAYS = 90;

export interface Autopay {
  payee: string;
  maxUqor: bigint;
  untilUnix: number;
  /** The transaction that set it. */
  tx: string;
  height: string;
}

export type AutopayMemo = { on: true; payee: string; maxUqor: bigint; untilUnix: number } | { on: false; payee: string };

const ADDR = /^0x[0-9a-f]{40}$/;

export function autopayOnMemo(payee: string, maxUqor: bigint, untilUnix: number): string {
  return `${AUTOPAY_PREFIX}on:${payee.toLowerCase()}:${maxUqor}:${untilUnix}`;
}

export function autopayOffMemo(payee: string): string {
  return `${AUTOPAY_PREFIX}off:${payee.toLowerCase()}`;
}

/** The transaction that carries an autopay memo: 1 uqor from the owner to itself. */
export function autopayMessage(owner: string): ChainMessage {
  return msg.bank.send({ fromAddress: owner, toAddress: owner, amount: [{ denom: "uqor", amount: "1" }] }) as ChainMessage;
}

/** Parse a memo, or null when it is not a well-formed autopay memo. */
export function parseAutopayMemo(memo: string): AutopayMemo | null {
  if (!memo.startsWith(AUTOPAY_PREFIX)) return null;
  const parts = memo.slice(AUTOPAY_PREFIX.length).split(":");
  if (parts[0] === "off" && parts.length === 2 && ADDR.test(parts[1])) return { on: false, payee: parts[1] };
  if (parts[0] === "on" && parts.length === 4 && ADDR.test(parts[1]) && /^\d{1,18}$/.test(parts[2]) && /^\d{1,12}$/.test(parts[3])) {
    const maxUqor = BigInt(parts[2]);
    const untilUnix = Number(parts[3]);
    if (maxUqor <= 0n) return null;
    return { on: true, payee: parts[1], maxUqor, untilUnix };
  }
  return null;
}

/**
 * Whether a delivered transaction is a valid autopay signal from `owner`:
 * succeeded, hybrid (post-quantum) signed, and a send from the owner to itself.
 */
export function isOwnerSignal(tx: DeliveredTx, owner: string): boolean {
  if (tx.code !== 0) return false;
  if (!tx.hybrid && !tx.events.some((e) => e.type === "pqc_hybrid_verify")) return false;
  const send = tx.messages.find((m) => m["@type"] === "/cosmos.bank.v1beta1.MsgSend");
  return !!send && send.from_address === owner && send.to_address === owner;
}

/**
 * The autopay permissions in force, from an owner's transactions (any order).
 * For each payee the newest valid signal decides; an "on" that has expired, or
 * runs longer than AUTOPAY_MAX_DAYS from when it was signed, counts as off.
 */
export function activeAutopays(txs: DeliveredTx[], owner: string, nowUnix: number): Autopay[] {
  const newestFirst = [...txs].sort((a, b) => Number(BigInt(b.height) - BigInt(a.height)));
  const decided = new Map<string, Autopay | null>();
  for (const tx of newestFirst) {
    const m = parseAutopayMemo(tx.memo);
    if (!m || decided.has(m.payee) || !isOwnerSignal(tx, owner)) continue;
    if (!m.on) {
      decided.set(m.payee, null);
      continue;
    }
    const signedAt = tx.timestamp ? Math.floor(Date.parse(tx.timestamp) / 1000) : nowUnix;
    const tooLong = m.untilUnix - signedAt > AUTOPAY_MAX_DAYS * 86400;
    decided.set(m.payee, m.untilUnix <= nowUnix || tooLong ? null : { payee: m.payee, maxUqor: m.maxUqor, untilUnix: m.untilUnix, tx: tx.hash, height: tx.height });
  }
  return [...decided.values()].filter((a): a is Autopay => a !== null);
}
