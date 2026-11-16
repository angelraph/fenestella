/**
 * Autopay end to end against a running Fenestella server, on testnet.
 *
 *   npx tsx --conditions=react-server scripts/spike-autopay.ts [baseUrl] [account]
 *
 * The owner (default demo3, with the agent on its vault leash, vendor approved):
 *  1. signs autopay for the vendor: up to 0.5 QOR a bill, 30 days;
 *  2. the vendor posts a 0.4 QOR bill and a 0.6 QOR bill;
 *  3. one round: the 0.4 bill is paid (vault + AI), the 0.6 bill is left (over the autopay max);
 *  4. the owner turns autopay off; another round pays nothing.
 */
import { autopayMessage, autopayOffMemo, autopayOnMemo } from "../lib/agent/autopay";
import { signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";

const base = process.argv[2] ?? "http://localhost:3000";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Steps = { steps: { ok: boolean; text: string; tx?: string }[] };
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}
const show = (s: Steps) => s.steps.forEach((x) => (x.ok ? ok : fail)(`${x.text}${x.tx ? ` (${x.tx})` : ""}`));

const owner = await signerFor(process.argv[3] ?? "demo3");
const ownerEvm = owner.evmAddress.toLowerCase();
const agent = await call<{ vendorEvm: string; vaultState: { vendorApproved: boolean; perPaymentUqor: string; balanceUqor: string } }>(`/api/agent?owner=${owner.address}&ownerEvm=${ownerEvm}`);
info(`owner ${owner.address}; vault ${JSON.stringify(agent.vaultState)}`);

step(1, "Owner signs autopay for the vendor: up to 0.5 QOR a bill, 30 days");
const until = Math.floor(Date.now() / 1000) + 30 * 86400;
const on = await owner.signAndBroadcast([autopayMessage(owner.address)], autopayOnMemo(agent.vendorEvm, 500_000n, until));
ok(`signed (${on.txHash})`);
await pause(3000);
const state = await call<{ autopays: { payee: string; maxUqor: string; tx: string }[] }>(`/api/agent/autopay?owner=${owner.address}`);
(state.autopays.some((a) => a.payee === agent.vendorEvm && a.maxUqor === "500000") ? ok : fail)(`the agent reads it from the chain: ${JSON.stringify(state.autopays)}`);

step(2, "Vendor posts a 0.4 QOR bill and a 0.6 QOR bill");
const b1 = await call<{ billId: string; tx: string }>("/api/agent/bill", { ownerEvm, amountUqor: "400000" });
ok(`bill #${b1.billId} 0.4 QOR (${b1.tx})`);
await pause(31_000);
const b2 = await call<{ billId: string; tx: string }>("/api/agent/bill", { ownerEvm, amountUqor: "600000" });
ok(`bill #${b2.billId} 0.6 QOR (${b2.tx})`);

step(3, "One autopay round");
show(await call<Steps>("/api/agent/autopay", { owner: owner.address }));

step(4, "Owner turns autopay off; the next round pays nothing");
const off = await owner.signAndBroadcast([autopayMessage(owner.address)], autopayOffMemo(agent.vendorEvm));
ok(`signed off (${off.txHash})`);
await pause(22_000);
show(await call<Steps>("/api/agent/autopay", { owner: owner.address }));
