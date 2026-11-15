/**
 * Read a delivered transaction and what the chain says happened inside it.
 * Used to tell a successful agent payment from one the chain refused: a
 * refused `MsgExecuteEVM` still lands in a code-0 transaction (chain v3.2.8),
 * with an `abstractaccount_execution_failed` event.
 */
export interface TxEvent {
  type: string;
  attributes: Record<string, string>;
}

export interface DeliveredTx {
  hash: string;
  height: string;
  code: number;
  codespace: string;
  rawLog: string;
  memo: string;
  timestamp: string;
  messages: { "@type": string; [k: string]: unknown }[];
  events: TxEvent[];
  /** The body carries the hybrid ML-DSA-87 extension. */
  hybrid: boolean;
  /** Signer-facing fee payer / first signer address, if the chain reports it. */
  signers: string[];
}

type Json = Record<string, unknown>;

export const EXECUTION_FAILED_EVENT = "abstractaccount_execution_failed";

function parseEvents(raw: unknown): TxEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const ev = e as Json;
    const attributes: Record<string, string> = {};
    for (const a of Array.isArray(ev.attributes) ? ev.attributes : []) {
      const at = a as Json;
      const k = String(at.key ?? "");
      if (k) attributes[k] = String(at.value ?? "");
    }
    return { type: String(ev.type ?? ""), attributes };
  });
}

export async function fetchTx(rest: string, hash: string, fetchFn: typeof fetch = fetch): Promise<DeliveredTx | null> {
  const res = await fetchFn(`${rest.replace(/\/$/, "")}/cosmos/tx/v1beta1/txs/${hash}`, { cache: "no-store" });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => ({}))) as Json;
  const r = body.tx_response as Json | undefined;
  if (!r) return null;
  const tx = (r.tx ?? body.tx ?? {}) as Json;
  const txBody = (tx.body ?? {}) as Json;
  const ext = Array.isArray(txBody.extension_options) ? (txBody.extension_options as Json[]) : [];
  const events = parseEvents(r.events);
  return {
    hash: String(r.txhash ?? hash),
    height: String(r.height ?? "0"),
    code: Number(r.code ?? 0),
    codespace: String(r.codespace ?? ""),
    rawLog: String(r.raw_log ?? ""),
    memo: String(txBody.memo ?? ""),
    timestamp: String(r.timestamp ?? ""),
    messages: (Array.isArray(txBody.messages) ? txBody.messages : []) as DeliveredTx["messages"],
    events,
    hybrid: ext.some((x) => String(x["@type"] ?? "").includes("PQCHybridSignature")),
    signers: events
      .filter((e) => e.type === "message" && e.attributes.sender)
      .map((e) => e.attributes.sender)
      .filter((v, i, a) => a.indexOf(v) === i),
  };
}

/** Poll until the transaction is in a block, or give up. */
export async function waitForTx(rest: string, hash: string, timeoutMs = 45_000): Promise<DeliveredTx> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tx = await fetchTx(rest, hash).catch(() => null);
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Transaction ${hash} was not seen in a block in time.`);
}

export function executionFailures(tx: DeliveredTx): TxEvent[] {
  return tx.events.filter((e) => e.type === EXECUTION_FAILED_EVENT);
}
