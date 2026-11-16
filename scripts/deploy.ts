/**
 * Deploy contracts to qorechain-diana and record them in deployments.testnet.json
 * (existing entries are kept).
 *
 *   cd contracts && forge build && cd .. && npx tsx scripts/deploy.ts [Name ...]
 *
 * With no names it deploys FenestellaReceipts and Bills.
 *
 * Contract creation is an EVM transaction, so the deployer opens a short,
 * unscoped window for exactly two transactions (a targets window refuses
 * contract creation), deploys, and closes the window again.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { NETWORKS } from "../lib/networks";
import { LocalSigner } from "../lib/signer/local";
import { info, loadMnemonic, ok, step } from "./lib";

const net = NETWORKS.testnet;
const chain = {
  id: net.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [net.evmRpc] } },
} as const;

function artifact(name: string): { abi: unknown[]; bytecode: Hex } {
  const j = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object as Hex };
}

async function main() {
  const { mnemonic } = loadMnemonic();
  const signer = await LocalSigner.fromMnemonic("testnet", mnemonic);
  const account = privateKeyToAccount(signer.account.privateKey as Hex);
  const pub = createPublicClient({ chain, transport: http(net.evmRpc) });
  const wallet = createWalletClient({ account, chain, transport: http(net.evmRpc) });
  console.log(`Deployer ${signer.address}\n         ${signer.evmAddress}`);

  const names = process.argv.slice(2).length ? process.argv.slice(2) : ["FenestellaReceipts", "Bills"];
  step(1, `Open a ${names.length}-transaction window for the deployment`);
  const opened = await signer.signAndBroadcast(
    [openWindowMessage(signer.address, { blocks: 200, maxTxs: names.length, maxValueUqor: "5000000" })],
    "fenestella: deploy window",
  );
  ok(`opened: ${opened.txHash}`);

  const deployed: Record<string, { address: string; txHash: string; block: string }> = {};
  let n = 2;
  try {
    for (const name of names) {
      step(n++, `Deploy ${name}`);
      const { abi, bytecode } = artifact(name);
      const hash = await wallet.deployContract({ abi, bytecode });
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed: ${hash}`);
      deployed[name] = { address: receipt.contractAddress, txHash: hash, block: receipt.blockNumber.toString() };
      ok(`${name} at ${receipt.contractAddress} (${hash})`);
    }
  } finally {
    step(n++, "Close the window");
    const truth = await readAccount("testnet", signer.address);
    if (truth.window?.live) {
      const closed = await signer.signAndBroadcast([closeWindowMessage(signer.address)], "fenestella: close deploy window");
      ok(`closed: ${closed.txHash}`);
    } else {
      ok("already used up");
    }
  }

  const prev = existsSync("deployments.testnet.json") ? JSON.parse(readFileSync("deployments.testnet.json", "utf8")) : {};
  const out = {
    network: net.chainId,
    evmChainId: net.evmChainId,
    deployer: { cosmos: signer.address, evm: signer.evmAddress },
    deployedAt: prev.deployedAt ?? new Date().toISOString(),
    contracts: { ...(prev.contracts ?? {}), ...deployed },
  };
  writeFileSync("deployments.testnet.json", JSON.stringify(out, null, 2) + "\n");
  info("written to deployments.testnet.json");
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
