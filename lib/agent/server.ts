import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fetchAuthNonce, resolveEvmAuthDigestVersion } from "@qorechain/sdk";
import { recipientOf, sealKeysFromSeed } from "@qorechain/qoreseal";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployments from "../../deployments.testnet.json";
import { readAccount } from "../chain/read";
import { executionFailures, fetchTx, waitForTx } from "../chain/tx";
import { closeWindowMessage, openWindowMessage } from "../messages";
import { NETWORKS } from "../networks";
import { LocalSigner } from "../signer/local";
import { agentAddress, agentExecuteEvm, agentLinkProof, AQOR_PER_UQOR, BILLS_ABI, payCalldata } from "./leash";
import { MandateError, openMandate, verifyAnchor, type MandateTerms } from "./mandate";

/**
 * The reference agent: a bill payer that runs on this server, testnet only.
 *
 * It holds one secp256k1 key, linked to whichever owner account hires it, and
 * no other authority: the owner's spending rule decides what it can move and
 * which contract it can call. A relayer account broadcasts what it signs and
 * pays the fee. A vendor account posts test bills so there is something to pay.
 *
 * Keys come from the environment (FENESTELLA_AGENT_KEY, FENESTELLA_RELAYER_MNEMONIC,
 * FENESTELLA_VENDOR_MNEMONIC) or, in local development, from .keys/. They are
 * throwaway testnet keys holding only test QOR.
 */
const net = NETWORKS.testnet;
export const BILLS = deployments.contracts.Bills.address as Hex;
const chain = {
  id: net.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [net.evmRpc] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http(net.evmRpc) });

function secret(env: string, file: string): string {
  const v = process.env[env]?.trim();
  if (v) return v;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  throw new Error(`The agent is not configured on this server (${env} is missing).`);
}

let cache: { agentKey: Hex; relayer: LocalSigner; vendor: LocalSigner } | null = null;

async function keys() {
  if (cache) return cache;
  const agentKey = secret("FENESTELLA_AGENT_KEY", ".keys/agent.key") as Hex;
  const relayer = await LocalSigner.fromMnemonic("testnet", secret("FENESTELLA_RELAYER_MNEMONIC", ".keys/relayer.mnemonic"), {
    gas: 700_000,
    feeUqor: "70000",
    label: "Fenestella relayer",
  });
  const vendor = await LocalSigner.fromMnemonic("testnet", secret("FENESTELLA_VENDOR_MNEMONIC", ".keys/vendor.mnemonic"), {
    gas: 400_000,
    feeUqor: "40000",
    label: "Test vendor",
  });
  cache = { agentKey, relayer, vendor };
  return cache;
}

/** The agent's seal keys, derived from its key so there is one secret to keep. */
function agentSealKeys(agentKey: Hex) {
  const seed = createHash("sha256").update(`fenestella-agent-seal|${agentKey}`).digest();
  return sealKeysFromSeed(new Uint8Array(seed));
}

export interface AgentInfo {
  agent: string;
  relayer: string;
  vendor: string;
  vendorEvm: string;
  bills: string;
  chainId: string;
  /** The agent's QoreSeal recipient keys, base64. */
  sealRecipient: { mlkemPublicKey: string; x25519PublicKey: string };
  suggestedTerms: { perTxUqor: string; dailyUqor: string; days: number };
  /** For `owner`: the agent's proof that it holds its key, to put in the owner's link transaction. Hex. */
  linkProof?: { pubkey: string; possessionProof: string };
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

export async function agentInfo(owner?: string): Promise<AgentInfo> {
  const k = await keys();
  const r = recipientOf(agentSealKeys(k.agentKey));
  const proof = owner ? agentLinkProof(k.agentKey, owner, net.chainId) : null;
  return {
    linkProof: proof ? { pubkey: hex(proof.pubkey), possessionProof: hex(proof.possessionProof) } : undefined,
    agent: agentAddress(k.agentKey),
    relayer: k.relayer.address,
    vendor: k.vendor.address,
    vendorEvm: k.vendor.evmAddress.toLowerCase(),
    bills: BILLS.toLowerCase(),
    chainId: net.chainId,
    sealRecipient: { mlkemPublicKey: b64(r.mlkemPublicKey), x25519PublicKey: b64(r.x25519PublicKey!) },
    suggestedTerms: { perTxUqor: "1000000", dailyUqor: "3000000", days: 14 },
  };
}

export interface Step {
  ok: boolean;
  text: string;
  tx?: string;
}

export interface BillView {
  id: string;
  payee: string;
  payer: string;
  amountUqor: string;
  paid: boolean;
}

export async function billsFor(ownerEvm: string): Promise<BillView[]> {
  const count = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "count" });
  const out: BillView[] = [];
  const from = count > 30n ? count - 30n : 0n;
  for (let i = count - 1n; i >= from && i >= 0n; i--) {
    const b = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "billOf", args: [i] });
    if (b.payer.toLowerCase() === ownerEvm.toLowerCase()) {
      out.push({ id: i.toString(), payee: b.payee.toLowerCase(), payer: b.payer.toLowerCase(), amountUqor: (b.amount / AQOR_PER_UQOR).toString(), paid: b.paid });
    }
    if (i === 0n) break;
  }
  return out;
}

/** The test vendor posts a bill payable by `ownerEvm`. */
export async function postTestBill(ownerEvm: string, amountUqor: bigint): Promise<{ billId: string; tx: string }> {
  if (amountUqor <= 0n || amountUqor > 2_000_000n) throw new MandateError("A test bill is between 0.000001 and 2 QOR.");
  const { vendor } = await keys();
  const before = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "count" });
  await vendor.signAndBroadcast(
    [openWindowMessage(vendor.address, { blocks: 120, maxTxs: 1, maxValueUqor: "500000", allowedTargets: [BILLS] })],
    "fenestella vendor: one-call window",
  );
  try {
    const wallet = createWalletClient({ account: privateKeyToAccount(vendor.account.privateKey as Hex), chain, transport: http(net.evmRpc) });
    const memo = `0x${createHash("sha256").update(`test bill for ${ownerEvm} at ${Date.now()}`).digest("hex")}` as Hex;
    const hash = await wallet.writeContract({
      address: BILLS,
      abi: BILLS_ABI,
      functionName: "createBill",
      args: [ownerEvm as Hex, amountUqor * AQOR_PER_UQOR, memo],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("The bill could not be posted.");
    return { billId: before.toString(), tx: hash };
  } finally {
    const w = (await readAccount("testnet", vendor.address)).window;
    if (w?.live) await vendor.signAndBroadcast([closeWindowMessage(vendor.address)], "fenestella vendor: close window");
  }
}

async function relayAgentCall(owner: string, to: Hex, valueUqor: bigint, data: Hex | undefined, memo: string) {
  const { agentKey, relayer } = await keys();
  const agent = agentAddress(agentKey);
  const [digestVersion, nonce] = await Promise.all([
    resolveEvmAuthDigestVersion({ rest: net.rest }),
    fetchAuthNonce({ rest: net.rest, address: owner, pubkey: agent }),
  ]);
  if (!nonce.linked) throw new MandateError("This account has not linked the Fenestella agent, or has revoked it.");
  const m = await agentExecuteEvm({
    agentPrivateKey: agentKey,
    account: owner,
    relayer: relayer.address,
    chainId: net.chainId,
    to,
    valueUqor,
    data,
    nonce: nonce.nonce,
    digestVersion,
  });
  const sent = await relayer.signAndBroadcast([m], memo);
  const tx = await waitForTx(net.rest, sent.txHash);
  const failed = executionFailures(tx);
  return { tx: sent.txHash, refused: failed[0]?.attributes.reason ?? null };
}

/** Run one mandate: authenticate it, open it, check the bill, pay. Every step is reported. */
export async function runMandate(input: { envelope: string; anchorTx: string; terms: MandateTerms }): Promise<Step[]> {
  const steps: Step[] = [];
  const { agentKey } = await keys();
  const t = input.terms;
  try {
    if (t.chainId !== net.chainId) throw new MandateError("This agent works on qorechain-diana only.");
    if (t.bills.toLowerCase() !== BILLS.toLowerCase()) throw new MandateError("This agent pays bills on the Fenestella Bills contract only.");

    verifyAnchor(await fetchTx(net.rest, input.anchorTx), t.owner, input.envelope);
    steps.push({ ok: true, text: "The owner signed this mandate: the anchor transaction is hybrid-signed by the owner and commits to this exact envelope.", tx: input.anchorTx });

    const m = openMandate(input.envelope, t, agentSealKeys(agentKey));
    steps.push({ ok: true, text: `Opened the sealed mandate with the agent's ML-KEM-1024 key. Note from the owner: "${m.note.slice(0, 140)}"` });

    if (Math.floor(Date.now() / 1000) > m.notAfter) throw new MandateError("The mandate has expired.");
    const owner = await readAccount("testnet", m.owner);
    const bill = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "billOf", args: [BigInt(m.billId)] });
    const amountUqor = bill.amount / AQOR_PER_UQOR;
    if (bill.payer.toLowerCase() !== owner.address.evm.toLowerCase()) throw new MandateError("That bill is not addressed to the owner.");
    if (bill.payee.toLowerCase() !== m.payee.toLowerCase()) throw new MandateError("That bill pays someone other than the mandate names.");
    if (bill.paid) throw new MandateError("That bill is already paid.");
    if (amountUqor > BigInt(m.maxUqor)) throw new MandateError(`The bill asks ${amountUqor} uqor; the mandate allows at most ${m.maxUqor}.`);
    steps.push({ ok: true, text: `Checked bill #${m.billId} on chain: unpaid, addressed to the owner, ${amountUqor} uqor to the payee the mandate names.` });

    const r = await relayAgentCall(m.owner, BILLS, amountUqor, payCalldata(BigInt(m.billId)), `fenestella agent: pay bill ${m.billId}`);
    if (r.refused) {
      steps.push({ ok: false, text: `The chain refused the payment: ${r.refused}`, tx: r.tx });
    } else {
      steps.push({ ok: true, text: "Paid. The relayer broadcast the agent's signed call and paid the fee; the chain checked it against the owner's spending rule.", tx: r.tx });
    }
  } catch (err) {
    steps.push({ ok: false, text: err instanceof Error ? err.message : "The agent stopped." });
  }
  return steps;
}

/**
 * What a stolen or misbehaving agent would try: send most of the owner's
 * balance to an outside address. The agent's own checks are skipped on
 * purpose; only the chain stands in the way.
 */
export async function rogueDrain(owner: string): Promise<Step[]> {
  const steps: Step[] = [];
  try {
    const t = await readAccount("testnet", owner);
    const take = BigInt(t.balanceUqor) > 2_000_000n ? BigInt(t.balanceUqor) - 1_000_000n : 5_000_000n;
    steps.push({ ok: true, text: `The agent key signs: send ${take} uqor (most of the balance) to 0x…dEaD. No mandate, no checks.` });
    const r = await relayAgentCall(owner, "0x000000000000000000000000000000000000dEaD", take, undefined, "fenestella: rogue agent drill");
    if (r.refused) steps.push({ ok: true, text: `Refused by the chain: ${r.refused}`, tx: r.tx });
    else steps.push({ ok: false, text: "The chain accepted it. The account's spending rule does not bound this key.", tx: r.tx });
  } catch (err) {
    steps.push({ ok: false, text: err instanceof Error ? err.message : "The drill stopped." });
  }
  return steps;
}
