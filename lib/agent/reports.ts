import "server-only";
import { msg } from "@qorechain/sdk";
import { classicalKeyFromPrivate, signMessage } from "@qorechain/qoresign";
import { fetchKemKey, sealToAddresses } from "@qorechain/qoreseal/network";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createHash } from "node:crypto";
import { createWalletClient, encodeFunctionData, hexToBytes, http, keccak256, parseAbi, toBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployments from "../../deployments.testnet.json";
import { readAccount } from "../chain/read";
import { openWindowMessage } from "../messages";
import { NETWORKS } from "../networks";
import { LocalSigner } from "../signer/local";

/**
 * Two-way authenticated messaging, the agent's half: after every payment the
 * agent writes the owner a report, signs it with its own on-chain identity
 * (a hybrid secp256k1 + ML-DSA-87 signature, QoreSign), seals it to the owner's
 * registered ML-KEM-1024 key (QoreSeal, post-quantum only), and posts it to the
 * AgentReports contract. Only the owner can open it; anyone who opens it can
 * check the signature against the agent's key on chain.
 *
 * The agent's identity is a testnet account derived from the agent's master
 * secret, so there is still one secret to keep.
 */
const net = NETWORKS.testnet;
export const REPORTS = ((deployments.contracts as Record<string, { address: string }>).AgentReports?.address ?? "").toLowerCase() as Hex;
export const REPORTS_FROM_BLOCK = BigInt((deployments.contracts as Record<string, { block?: string }>).AgentReports?.block ?? "0");
export const REPORT_PURPOSE = "fenestella/agent-report/v1";
const ABI = parseAbi(["function post(address owner, bytes32 ref, bytes envelope)"]);
const chain = { id: net.evmChainId, name: "QoreChain Testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [net.evmRpc] } } } as const;

export interface AgentReport {
  v: 1;
  kind: "payment";
  owner: string;
  billId: string;
  payee: string;
  payeeName: string | null;
  amountUqor: string;
  /** The payment transaction. */
  tx: string;
  /** "mandate" or "autopay", and what authorised it. */
  basis: { kind: "mandate" | "autopay"; tx: string };
  ai: { model: string; reason: string };
  at: string;
}

let identity: LocalSigner | null = null;

/** The agent's own account. Derived from the master secret; never stored. */
export async function agentIdentity(master: Hex): Promise<LocalSigner> {
  if (identity) return identity;
  const entropy = createHash("sha256").update(`fenestella-agent-identity|${master}`).digest();
  identity = await LocalSigner.fromMnemonic("testnet", entropyToMnemonic(new Uint8Array(entropy), wordlist), { gas: 400_000, feeUqor: "40000", label: "Fenestella agent" });
  return identity;
}

/** Fund the identity and register its post-quantum key, once. */
export async function ensureIdentity(master: Hex, funder: LocalSigner): Promise<LocalSigner> {
  const id = await agentIdentity(master);
  const t = await readAccount("testnet", id.address);
  if (BigInt(t.balanceUqor) < 400_000n) {
    await funder.signAndBroadcast([msg.bank.send({ fromAddress: funder.address, toAddress: id.address, amount: [{ denom: "uqor", amount: "1500000" }] })], "fenestella: fees for the agent's identity");
  }
  if (!t.pqc.registered && !(await id.isPqcRegistered())) await id.registerPqcKey();
  return id;
}

/** Keep a window open on the identity that reaches only AgentReports. */
async function ensureReportWindow(id: LocalSigner) {
  const w = (await readAccount("testnet", id.address)).window;
  const ok = w?.live && BigInt(w.remainingTxs) > 0n && BigInt(w.remainingBlocks) > 60n && BigInt(w.remainingValue) > 60_000n && w.allowedTargets.map((x) => x.toLowerCase()).includes(REPORTS);
  if (ok) return;
  await id.signAndBroadcast([openWindowMessage(id.address, { blocks: 17_280, maxTxs: 60, maxValueUqor: "1200000", allowedTargets: [REPORTS] })], "fenestella agent: window for reports only");
}

/**
 * Sign, seal and post a report. Returns null when the owner has not published
 * an encryption key (then there is no one the report could be sealed to).
 */
export async function postReport(master: Hex, funder: LocalSigner, ownerEvm: string, report: AgentReport): Promise<{ tx: string; signer: string } | null> {
  if (!REPORTS) return null;
  const kem = await fetchKemKey({ rest: net.rest, address: report.owner }).catch(() => null);
  if (!kem || !("found" in kem) || !kem.found) return null;
  const id = await ensureIdentity(master, funder);
  const body = JSON.stringify(report);
  const signature = signMessage({
    chainId: net.chainId,
    signer: id.address,
    data: body,
    classicalKey: classicalKeyFromPrivate(hexToBytes(id.account.privateKey as Hex), "eth_secp256k1"),
    pqKey: id.account.pqc,
  });
  const plaintext = new TextEncoder().encode(JSON.stringify({ report: body, signer: id.address, signature }));
  const envelope = await sealToAddresses({ rest: net.rest, chainId: net.chainId, purpose: REPORT_PURPOSE, plaintext, recipients: [{ address: report.owner }], mode: "mlkem" });
  await ensureReportWindow(id);
  const wallet = createWalletClient({ account: privateKeyToAccount(id.account.privateKey as Hex), chain, transport: http(net.evmRpc) });
  const ref = keccak256(toBytes(report.tx));
  const hash = await wallet.sendTransaction({ to: REPORTS, data: encodeFunctionData({ abi: ABI, functionName: "post", args: [ownerEvm as Hex, ref, toHex(envelope)] }), gas: 1_500_000n });
  return { tx: hash, signer: id.address };
}
