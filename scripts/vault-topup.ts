/**
 * Keep a test account's AgentVault funded, so the live demos (the no-wallet AI
 * panel, the MCP agent) have a genuine bill the vault can pay.
 *
 *   npx tsx scripts/vault-topup.ts [account=demo3] [qor=1]
 *
 * Tops the account up from the dev account if needed, then deposits through a
 * one-transaction window scoped to the vault, and closes it.
 */
import { createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { NATIVE, VAULT, VAULT_ABI } from "../lib/agent/vault";
import { chain, ensureReady, publicClient, signerFor } from "./lib-accounts";
import { ok } from "./lib";

const name = process.argv[2] ?? "demo3";
const qor = Number(process.argv[3] ?? "1");
const uqor = BigInt(Math.round(qor * 1_000_000));

async function main() {
  const owner = await signerFor(name);
  await ensureReady(owner, uqor + 600_000n, name);
  await owner.signAndBroadcast(
    [openWindowMessage(owner.address, { blocks: 120, maxTxs: 1, maxValueUqor: (uqor + 300_000n).toString(), allowedTargets: [VAULT] })],
    "fenestella: deposit window",
  );
  const wallet = createWalletClient({ account: privateKeyToAccount(owner.account.privateKey as Hex), chain, transport: http(chain.rpcUrls.default.http[0]) });
  const hash = await wallet.sendTransaction({
    to: VAULT,
    value: uqor * 1_000_000_000_000n,
    gas: 120_000n,
    data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [owner.evmAddress.toLowerCase() as Hex] }),
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const w = (await readAccount("testnet", owner.address)).window;
  if (w?.live) await owner.signAndBroadcast([closeWindowMessage(owner.address)], "fenestella: close deposit window");
  const bal = await publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "balanceOf", args: [owner.evmAddress.toLowerCase() as Hex, NATIVE] });
  ok(`${name}: deposited ${qor} QOR (${hash}); vault now ${Number(bal / 1_000_000_000_000n) / 1e6} QOR`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
