import { msg } from "@qorechain/sdk";
import { envelopeFromText, envelopeToText, open, seal, type SealRecipient } from "@qorechain/qoreseal";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "viem";
import type { DeliveredTx } from "../chain/tx";
import type { ChainMessage } from "../signer/types";

/**
 * A mandate is the owner's instruction to the agent: pay this bill, up to this
 * much, before this time. It travels sealed and is authenticated on chain.
 *
 * - Sealed with QoreSeal (ML-KEM-1024 + X25519, AES-256-GCM) to the agent and,
 *   when the owner holds seal keys, to the owner, so the owner can reopen it.
 * - The public terms (bill, payee, cap, deadline) are the envelope's
 *   associated data: change any of them and the envelope does not open.
 * - The owner anchors SHA3-256 of the envelope in a hybrid-signed transaction
 *   (a 1 uqor self-send with the hash in its memo). QoreX shows memos, so no
 *   custom message or arbitrary signing is needed. The agent accepts a
 *   mandate only if that transaction exists, came from the owner, and carries
 *   the ML-DSA-87 signature.
 */
export const MANDATE_PURPOSE = "fenestella/mandate/v1";
export const ANCHOR_PREFIX = "fenestella-mandate:";

export interface MandateTerms {
  chainId: string;
  /** The owner's account (`qor1…`), which the agent pays from. */
  owner: string;
  bills: string;
  billId: string;
  /** Who the bill must pay (`0x…`). */
  payee: string;
  /** The most the agent may pay, in uqor. */
  maxUqor: string;
  /** Unix seconds after which the mandate is void. */
  notAfter: number;
}

export interface Mandate extends MandateTerms {
  v: 1;
  kind: "pay-bill";
  /** Free text for the agent, sealed with the rest. */
  note: string;
}

const te = new TextEncoder();
const td = new TextDecoder();

export function mandateAad(t: MandateTerms): Uint8Array {
  return te.encode(
    [MANDATE_PURPOSE, t.chainId, t.owner, t.bills.toLowerCase(), t.billId, t.payee.toLowerCase(), t.maxUqor, String(t.notAfter)].join("|"),
  );
}

export function termsOf(m: MandateTerms): MandateTerms {
  return {
    chainId: m.chainId,
    owner: m.owner,
    bills: m.bills.toLowerCase(),
    billId: m.billId,
    payee: m.payee.toLowerCase(),
    maxUqor: m.maxUqor,
    notAfter: m.notAfter,
  };
}

export function sealMandate(m: Mandate, recipients: SealRecipient[]): string {
  const envelope = seal({
    chainId: m.chainId,
    purpose: MANDATE_PURPOSE,
    recipients,
    plaintext: te.encode(JSON.stringify({ ...m, ...termsOf(m) })),
    aad: mandateAad(m),
  });
  return envelopeToText(envelope);
}

export function envelopeDigest(envelopeText: string): string {
  return bytesToHex(sha3_256(envelopeFromText(envelopeText))).slice(2);
}

export function anchorMemo(envelopeText: string): string {
  return ANCHOR_PREFIX + envelopeDigest(envelopeText);
}

/** The anchor: a 1 uqor transfer to yourself whose memo carries the envelope's SHA3-256. */
export function anchorMessage(owner: string): ChainMessage {
  return msg.bank.send({ fromAddress: owner, toAddress: owner, amount: [{ denom: "uqor", amount: "1" }] }) as ChainMessage;
}

export class MandateError extends Error {}

/** Check the anchor transaction the owner signed for this envelope. Throws a plain reason when it does not hold. */
export function verifyAnchor(tx: DeliveredTx | null, owner: string, envelopeText: string): void {
  if (!tx) throw new MandateError("The anchor transaction was not found on chain.");
  if (tx.code !== 0) throw new MandateError(`The anchor transaction failed on chain (code ${tx.code}).`);
  if (tx.memo !== anchorMemo(envelopeText)) {
    throw new MandateError("The anchor transaction does not commit to this envelope: its memo carries a different fingerprint.");
  }
  const send = tx.messages.find((m) => m["@type"] === "/cosmos.bank.v1beta1.MsgSend");
  if (!send || send.from_address !== owner) {
    throw new MandateError("The anchor transaction was not sent by the account this mandate pays from.");
  }
  const verified = tx.events.some((e) => e.type === "pqc_hybrid_verify");
  if (!tx.hybrid && !verified) {
    throw new MandateError("The anchor transaction carries no post-quantum signature.");
  }
}

/** Open the envelope with the agent's keys against the claimed terms. A changed term makes this fail. */
export function openMandate(envelopeText: string, terms: MandateTerms, keys: Parameters<typeof open>[0]["keys"]): Mandate {
  let plaintext: Uint8Array;
  try {
    plaintext = open({ chainId: terms.chainId, purpose: MANDATE_PURPOSE, envelope: envelopeFromText(envelopeText), keys, aad: mandateAad(terms) });
  } catch {
    throw new MandateError("The envelope does not open with these terms. It was sealed for different terms, or not for this agent.");
  }
  const m = JSON.parse(td.decode(plaintext)) as Mandate;
  const a = termsOf(m);
  const b = termsOf(terms);
  for (const k of Object.keys(b) as (keyof MandateTerms)[]) {
    if (String(a[k]) !== String(b[k])) throw new MandateError(`The sealed mandate says ${k} = ${a[k]}, the request says ${b[k]}.`);
  }
  if (m.kind !== "pay-bill" || m.v !== 1) throw new MandateError("Unknown mandate kind.");
  return m;
}
