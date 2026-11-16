/**
 * The AgentVault flow end to end against a running Fenestella server.
 *
 *   npx tsx --conditions=react-server scripts/spike-vault.ts [baseUrl] [account]
 *
 * The owner (a local test account that linked the agent, default demo3):
 *  1. points the agent's leash at the vault: only AgentVault.payBill, 1 uqor;
 *  2. deposits into its vault (its own EVM transaction, in a window scoped to the vault);
 *  3. approves the vendor and sets limits, signed with its ML-DSA-87 key;
 * then a vendor bill is paid from a sealed, anchored mandate, and a stolen
 * agent key tries three attacks.
 */
import { msg, pqcSign } from "@qorechain/sdk";
import { bytesToHex, createPublicClient, encodeFunctionData, hexToBytes, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { leashRule } from "../lib/agent/leash";
import { anchorMemo, anchorMessage, sealMandate, type Mandate } from "../lib/agent/mandate";
import { ACTION, adminMessage, NATIVE, paramsHash, VAULT, VAULT_ABI, type VaultAdmin } from "../lib/agent/vault";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { NETWORKS } from "../lib/networks";
import { signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";

const base = process.argv[2] ?? "http://localhost:3000";
const net = NETWORKS.testnet;
const QOR = 1_000_000_000_000_000_000n;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}
type Steps = { steps: { ok: boolean; text: string; tx?: string }[] };
type Info = {
  agent: string; vault: string; paySelector: string; vendorEvm: string; bills: string;
  sealRecipient: { mlkemPublicKey: string; x25519PublicKey: string };
  vaultState: { balanceUqor: string; perPaymentUqor: string; perDayUqor: string; nonce: string; vendorApproved: boolean };
};

const owner = await signerFor(process.argv[3] ?? "demo3");
const ownerEvm = owner.evmAddress.toLowerCase() as Hex;
const info0 = await call<Info>(`/api/agent?owner=${owner.address}&ownerEvm=${ownerEvm}`);
console.log(`owner ${owner.address} (${ownerEvm})\nagent ${info0.agent}\nvault ${info0.vault}`);

step(1, "Point the leash at the vault: only payBill, 1 uqor a payment and a day");
const t = await readAccount("testnet", owner.address);
const want = `${VAULT}/${info0.paySelector}`;
if (t.abstractAccount.rules.some((r) => r.enabled && r.allowedEvmCalls.includes(want) && r.perTxLimit === "1")) info("already");
else {
  const rule = leashRule({ bills: VAULT, selector: info0.paySelector, perTxUqor: 1n, dailyUqor: 1n, expiryUnix: 0 });
  const r = await owner.signAndBroadcast([msg.abstractaccount.updateSpendingRules({ owner: owner.address, accountAddress: owner.address, rules: [rule] })], "fenestella: leash on the vault");
  ok(`rule set (${r.txHash})`);
}

step(2, "Deposit 1.5 QOR into the vault (owner's own EVM transaction, window scoped to the vault)");
if (BigInt(info0.vaultState.balanceUqor) >= 1_000_000n) info(`already holds ${info0.vaultState.balanceUqor} uqor`);
else {
  await owner.signAndBroadcast([openWindowMessage(owner.address, { blocks: 120, maxTxs: 1, maxValueUqor: "1700000", allowedTargets: [VAULT] })], "fenestella: deposit window");
  const p = await call<{ nonce: number; gasPrice: string; chainId: number }>(`/api/vault?evm=${ownerEvm}`);
  const acct = privateKeyToAccount(owner.account.privateKey as Hex);
  const raw = await acct.signTransaction({
    chainId: p.chainId, type: "legacy", nonce: p.nonce, gasPrice: BigInt(p.gasPrice), gas: 120_000n,
    to: VAULT, value: (QOR * 3n) / 2n, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [ownerEvm] }),
  });
  const d = await call<{ tx: string }>("/api/vault", { kind: "deposit", raw });
  ok(`deposited (${d.tx})`);
  const w = (await readAccount("testnet", owner.address)).window;
  if (w?.live) await owner.signAndBroadcast([closeWindowMessage(owner.address)], "fenestella: close deposit window");
}

step(3, "Approve the vendor and set limits (1 QOR a payment, 3 a day), signed with the owner's ML-DSA-87 key");
const pub = createPublicClient({ transport: http(net.evmRpc) });
const nonce = BigInt(info0.vaultState.nonce);
const admins: VaultAdmin[] = [
  { action: "payee", payee: info0.vendorEvm as Hex, approved: true },
  { action: "limits", token: NATIVE, perPayment: QOR, perDay: 3n * QOR },
];
const onChainMsg = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "messageFor", args: [ownerEvm, ACTION.payee, paramsHash(admins[0])] });
const local = adminMessage({ chainId: net.evmChainId, owner: ownerEvm, nonce, admin: admins[0] });
(onChainMsg.toLowerCase() === local.toLowerCase() ? ok : fail)(`the bytes we sign match the contract's messageFor exactly (${(local.length - 2) / 2} bytes)`);
const items = admins.map((admin, i) => ({
  admin: JSON.parse(JSON.stringify(admin, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  signature: bytesToHex(pqcSign(owner.account.pqc.secretKey, hexToBytes(adminMessage({ chainId: net.evmChainId, owner: ownerEvm, nonce: nonce + BigInt(i), admin })))),
}));
if (info0.vaultState.vendorApproved && info0.vaultState.perPaymentUqor === "1000000") info("already set");
else for (const s of (await call<Steps>("/api/vault", { kind: "admin", ownerEvm, items })).steps) (s.ok ? ok : fail)(`${s.text} (${s.tx})`);

const info1 = await call<Info>(`/api/agent?owner=${owner.address}&ownerEvm=${ownerEvm}`);
info(`vault now: ${JSON.stringify(info1.vaultState)}`);

step(4, "Vendor posts a 0.4 QOR bill to the owner's vault");
await pause(2000);
const bill = await call<{ billId: string; tx: string }>("/api/agent/bill", { ownerEvm, amountUqor: "400000" });
ok(`bill #${bill.billId} (${bill.tx})`);

step(5, "Owner seals a mandate and anchors it; the agent pays from the vault");
const m: Mandate = {
  v: 1, kind: "pay-bill", chainId: net.chainId, owner: owner.address, bills: info1.bills, billId: bill.billId,
  payee: info1.vendorEvm, maxUqor: "400000", notAfter: Math.floor(Date.now() / 1000) + 3600, note: "Pay the hosting invoice for November.",
};
const envelope = sealMandate(m, [{ mlkemPublicKey: fromBase64(info1.sealRecipient.mlkemPublicKey), x25519PublicKey: fromBase64(info1.sealRecipient.x25519PublicKey) }]);
const anchor = await owner.signAndBroadcast([anchorMessage(owner.address)], anchorMemo(envelope));
ok(`anchored (${anchor.txHash})`);
const terms = { chainId: m.chainId, owner: m.owner, bills: m.bills, billId: m.billId, payee: m.payee, maxUqor: m.maxUqor, notAfter: m.notAfter };
for (const s of (await call<Steps>("/api/agent/run", { envelope, anchorTx: anchor.txHash, terms })).steps) (s.ok ? ok : fail)(`${s.text}${s.tx ? ` (${s.tx})` : ""}`);

step(6, "A stolen agent key tries three attacks");
await pause(2000);
for (const s of (await call<Steps>("/api/agent/rogue", { owner: owner.address })).steps) (s.ok ? ok : fail)(`${s.text}${s.tx ? ` (${s.tx})` : ""}`);
