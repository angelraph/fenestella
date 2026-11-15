import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { msg } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { NETWORKS } from "../lib/networks";
import { LocalSigner } from "../lib/signer/local";
import { info, loadMnemonic, ok } from "./lib";

export const net = NETWORKS.testnet;
export const chain = {
  id: net.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [net.evmRpc] } },
} as const;
export const publicClient = createPublicClient({ chain, transport: http(net.evmRpc) });

export async function signerFor(name: string, gas = 700_000, feeUqor = "70000"): Promise<LocalSigner> {
  return LocalSigner.fromMnemonic("testnet", loadMnemonic(name).mnemonic, { gas, feeUqor });
}

/** Testnet only: a throwaway secp256k1 key kept in .keys/<name>.key (git-ignored). */
export function loadKey(name: string): Hex {
  const file = `.keys/${name}.key`;
  if (existsSync(file)) return readFileSync(file, "utf8").trim() as Hex;
  mkdirSync(".keys", { recursive: true });
  const key = generatePrivateKey();
  writeFileSync(file, key + "\n", { mode: 0o600 });
  return key;
}

/** Make sure `s` exists on chain with at least `minUqor`, funded by the dev account, and has its PQ key. */
export async function ensureReady(s: LocalSigner, minUqor: bigint, label: string): Promise<void> {
  const t = await readAccount("testnet", s.address);
  if (BigInt(t.balanceUqor) < minUqor) {
    const dev = await signerFor("dev");
    const top = minUqor - BigInt(t.balanceUqor) + 200_000n;
    const r = await dev.signAndBroadcast(
      [msg.bank.send({ fromAddress: dev.address, toAddress: s.address, amount: [{ denom: "uqor", amount: top.toString() }] })],
      `fenestella: fund ${label}`,
    );
    ok(`funded ${label} with ${top} uqor (${r.txHash})`);
  }
  if (!(await s.isPqcRegistered())) {
    const r = await s.registerPqcKey();
    ok(`${label} post-quantum key registered (${r.txHash})`);
  }
}

/** Run one EVM call from a LocalSigner's own account inside a short window scoped to `to`. */
export async function evmCallInWindow(s: LocalSigner, to: Hex, call: (w: ReturnType<typeof walletFor>) => Promise<Hex>): Promise<Hex> {
  await s.signAndBroadcast([openWindowMessage(s.address, { blocks: 120, maxTxs: 1, maxValueUqor: "1000000", allowedTargets: [to] })], "fenestella: one-call window");
  const wallet = walletFor(s);
  const hash = await call(wallet);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`EVM call reverted: ${hash}`);
  const after = await readAccount("testnet", s.address);
  if (after.window?.live) await s.signAndBroadcast([closeWindowMessage(s.address)], "fenestella: close window");
  info(`window opened, used once, closed`);
  return hash;
}

export function walletFor(s: LocalSigner) {
  return createWalletClient({ account: privateKeyToAccount(s.account.privateKey as Hex), chain, transport: http(net.evmRpc) });
}
