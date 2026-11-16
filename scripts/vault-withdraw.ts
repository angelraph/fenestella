/**
 * Withdraw an owner's whole native balance from an AgentVault with an
 * ML-DSA-87-signed withdrawal, relayed by the relayer (anyone may relay; the
 * money still goes only to the owner).
 *
 *   npx tsx --conditions=react-server scripts/vault-withdraw.ts <vault 0x...> [account]
 */
import { pqcSign } from "@qorechain/sdk";
import { bytesToHex, createPublicClient, createWalletClient, hexToBytes, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { adminCalldata, adminMessage, NATIVE, VAULT_ABI } from "../lib/agent/vault";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { NETWORKS } from "../lib/networks";
import { signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";

const net = NETWORKS.testnet;
const vault = (process.argv[2] ?? "").toLowerCase() as Hex;
if (!/^0x[0-9a-f]{40}$/.test(vault)) throw new Error("usage: vault-withdraw.ts <vault> [account]");
const owner = await signerFor(process.argv[3] ?? "demo3");
const relayer = await signerFor("relayer");
const ownerEvm = owner.evmAddress.toLowerCase() as Hex;
const chain = { id: net.evmChainId, name: "QoreChain Testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [net.evmRpc] } } } as const;
const pub = createPublicClient({ chain, transport: http(net.evmRpc) });

const bal = await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "balanceOf", args: [ownerEvm, NATIVE] });
const nonce = await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "nonces", args: [ownerEvm] });
info(`vault ${vault}: ${bal} aqor for ${ownerEvm}, nonce ${nonce}`);
if (bal === 0n) {
  info("nothing to withdraw");
  process.exit(0);
}
const before = BigInt((await readAccount("testnet", owner.address)).balanceUqor);

step(1, "The owner signs the withdrawal with its ML-DSA-87 key");
const admin = { action: "withdraw" as const, token: NATIVE, amount: bal };
const sig = bytesToHex(pqcSign(owner.account.pqc.secretKey, hexToBytes(adminMessage({ chainId: net.evmChainId, owner: ownerEvm, nonce, admin, vault }))));
ok(`${(sig.length - 2) / 2}-byte signature`);

step(2, "The relayer sends it (one-call window scoped to the vault)");
await relayer.signAndBroadcast([openWindowMessage(relayer.address, { blocks: 120, maxTxs: 1, maxValueUqor: "500000", allowedTargets: [vault] })], "fenestella relayer: withdrawal window");
const wallet = createWalletClient({ account: privateKeyToAccount(relayer.account.privateKey as Hex), chain, transport: http(net.evmRpc) });
const hash = await wallet.sendTransaction({ to: vault, data: adminCalldata(ownerEvm, admin, sig), gas: 1_500_000n });
const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
const w = (await readAccount("testnet", relayer.address)).window;
if (w?.live) await relayer.signAndBroadcast([closeWindowMessage(relayer.address)], "fenestella relayer: close window");
const after = BigInt((await readAccount("testnet", owner.address)).balanceUqor);
(r.status === "success" ? ok : fail)(`withdrawn: ${r.status} (${hash}); owner balance ${before} -> ${after} uqor`);
