/**
 * Spike: the whole mandate flow against a running Fenestella server.
 *
 *   npm run dev            (in another terminal)
 *   npx tsx scripts/spike-mandate.ts [baseUrl]
 *
 * Owner = the dev account, which already linked the agent (spike-agent.ts).
 */
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
import { anchorMemo, anchorMessage, sealMandate, type Mandate } from "../lib/agent/mandate";
import { fail, info, ok, step } from "./lib";
import { net, signerFor } from "./lib-accounts";

const base = process.argv[2] ?? "http://localhost:3000";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

type Steps = { steps: { ok: boolean; text: string; tx?: string }[] };

async function main() {
  const owner = await signerFor("dev");
  const ownerEvm = owner.evmAddress.toLowerCase();

  step(1, "Agent info");
  const a = await call<{ agent: string; relayer: string; vendorEvm: string; bills: string; sealRecipient: { mlkemPublicKey: string; x25519PublicKey: string } }>(`/api/agent?ownerEvm=${ownerEvm}`);
  ok(`agent ${a.agent}, relayer ${a.relayer}`);

  step(2, "Vendor posts a 0.4 QOR bill");
  const bill = await call<{ billId: string; tx: string }>("/api/agent/bill", { ownerEvm, amountUqor: "400000" });
  ok(`bill #${bill.billId} (${bill.tx})`);

  step(3, "Owner seals a mandate and anchors it");
  const m: Mandate = {
    v: 1, kind: "pay-bill", chainId: net.chainId, owner: owner.address, bills: a.bills, billId: bill.billId,
    payee: a.vendorEvm, maxUqor: "500000", notAfter: Math.floor(Date.now() / 1000) + 3600, note: "Pay the hosting invoice for November.",
  };
  const envelope = sealMandate(m, [{ mlkemPublicKey: fromBase64(a.sealRecipient.mlkemPublicKey), x25519PublicKey: fromBase64(a.sealRecipient.x25519PublicKey) }]);
  info(`envelope ${envelope.length} chars, memo ${anchorMemo(envelope)}`);
  const anchor = await owner.signAndBroadcast([anchorMessage(owner.address)], anchorMemo(envelope));
  ok(`anchored (${anchor.txHash})`);
  const terms = { chainId: m.chainId, owner: m.owner, bills: m.bills, billId: m.billId, payee: m.payee, maxUqor: m.maxUqor, notAfter: m.notAfter };

  step(4, "Tampered terms (cap raised) must not open");
  const bad = await call<Steps>("/api/agent/run", { envelope, anchorTx: anchor.txHash, terms: { ...terms, maxUqor: "1500000" } });
  const last = bad.steps[bad.steps.length - 1];
  if (!last.ok && /does not open/.test(last.text)) ok(`refused: ${last.text}`);
  else fail(JSON.stringify(bad.steps));

  await new Promise((r) => setTimeout(r, 16_000));
  step(5, "The real mandate: agent pays");
  const good = await call<Steps>("/api/agent/run", { envelope, anchorTx: anchor.txHash, terms });
  for (const s of good.steps) (s.ok ? ok : fail)(`${s.text}${s.tx ? ` (${s.tx})` : ""}`);

  step(6, "Rogue agent tries to drain the owner");
  const rogue = await call<Steps>("/api/agent/rogue", { owner: owner.address });
  for (const s of rogue.steps) (s.ok ? ok : fail)(`${s.text}${s.tx ? ` (${s.tx})` : ""}`);
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
