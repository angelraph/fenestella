/**
 * Spike: an agent on a leash, end to end on qorechain-diana.
 *
 *   npx tsx scripts/spike-agent.ts
 *
 * Owner = the dev account. Vendor posts a bill on Bills. The agent key is
 * linked to the owner's account with the `evm` permission and a spending rule
 * that allows only Bills.pay, at most 1 QOR a payment and 3 QOR a day. A
 * separate relayer broadcasts what the agent signs and pays the fee.
 *
 * It then checks three things the chain must enforce:
 *   1. the agent pays the bill (no EVM window on the owner's account);
 *   2. "send the whole balance to an outside address" is refused;
 *   3. a call to any other contract is refused.
 */
import { fetchAuthNonce, resolveEvmAuthDigestVersion } from "@qorechain/sdk";
import { decodeEventLog, encodeFunctionData, parseAbi, parseEther, type Hex } from "viem";
import { readAccount } from "../lib/chain/read";
import { executionFailures, waitForTx } from "../lib/chain/tx";
import { agentAddress, agentExecuteEvm, BILLS_ABI, createAbstractAccountMessage, linkAgentMessages, payCalldata } from "../lib/agent/leash";
import deployments from "../deployments.testnet.json";
import { ensureReady, evmCallInWindow, loadKey, net, publicClient, signerFor } from "./lib-accounts";
import { fail, info, ok, step } from "./lib";

const BILLS = deployments.contracts.Bills.address as Hex;
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as Hex;

async function relay(relayer: Awaited<ReturnType<typeof signerFor>>, m: Parameters<typeof relayer.signAndBroadcast>[0][number], memo: string) {
  const r = await relayer.signAndBroadcast([m], memo);
  const tx = await waitForTx(net.rest, r.txHash);
  const failed = executionFailures(tx);
  return { hash: r.txHash, tx, failed };
}

async function main() {
  const owner = await signerFor("dev");
  const relayer = await signerFor("relayer");
  const vendor = await signerFor("vendor");
  const agentKey = loadKey("agent");
  const agent = agentAddress(agentKey);
  console.log(`Owner   ${owner.address} (${owner.evmAddress})\nRelayer ${relayer.address}\nVendor  ${vendor.address} (${vendor.evmAddress})\nAgent   ${agent}\nBills   ${BILLS}`);

  step(1, "Relayer and vendor are funded and registered");
  await ensureReady(relayer, 2_000_000n, "relayer");
  await ensureReady(vendor, 1_500_000n, "vendor");

  step(2, "Owner has an abstract-account record");
  const aa = await readAccount("testnet", owner.address);
  if (aa.abstractAccount.account) ok(`exists (${aa.abstractAccount.account.type})`);
  else ok(`created: ${(await owner.signAndBroadcast([createAbstractAccountMessage(owner.address)], "fenestella: abstract account")).txHash}`);

  step(3, "Link the agent: rule first, then the key (one owner-signed transaction)");
  const linked = (await readAccount("testnet", owner.address)).abstractAccount.authenticators.find(
    (a) => a.pubkeyHex.toLowerCase() === agent.slice(2).toLowerCase() && !a.revoked,
  );
  if (linked) ok("agent already linked");
  else {
    const msgs = linkAgentMessages({
      owner: owner.address,
      chainId: net.chainId,
      agentPrivateKey: agentKey,
      terms: { bills: BILLS, perTxUqor: 1_000_000n, dailyUqor: 3_000_000n, expiryUnix: Math.floor(Date.now() / 1000) + 14 * 86400 },
    });
    ok(`linked: ${(await owner.signAndBroadcast(msgs, "fenestella: link bill payer")).txHash}`);
  }
  const ownerTruth = await readAccount("testnet", owner.address);
  info(`rules: ${JSON.stringify(ownerTruth.abstractAccount.rules)}`);
  info(`owner window live: ${ownerTruth.window?.live ?? false}`);

  step(4, "Vendor posts a 0.5 QOR bill for the owner");
  const before = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "count" });
  const createHash = await evmCallInWindow(vendor, BILLS, (w) =>
    w.writeContract({ address: BILLS, abi: BILLS_ABI, functionName: "createBill", args: [owner.evmAddress as Hex, parseEther("0.5"), `0x${"ab".repeat(32)}`] }),
  );
  const billId = before;
  ok(`bill #${billId} created (${createHash})`);

  const digestVersion = await resolveEvmAuthDigestVersion({ rest: net.rest });
  const nonceOf = async () => (await fetchAuthNonce({ rest: net.rest, address: owner.address, pubkey: agent })).nonce;
  info(`digest ${digestVersion}, agent nonce ${await nonceOf()}`);

  step(5, "Agent pays the bill through the relayer");
  const ownerBefore = BigInt((await readAccount("testnet", owner.address)).balanceUqor);
  const payMsg = await agentExecuteEvm({
    agentPrivateKey: agentKey, account: owner.address, relayer: relayer.address, chainId: net.chainId,
    to: BILLS, valueUqor: 500_000n, data: payCalldata(billId), nonce: await nonceOf(), digestVersion,
  });
  const paid = await relay(relayer, payMsg, "fenestella agent: pay bill");
  const bill = await publicClient.readContract({ address: BILLS, abi: BILLS_ABI, functionName: "billOf", args: [billId] });
  const ownerAfter = BigInt((await readAccount("testnet", owner.address)).balanceUqor);
  if (paid.failed.length === 0 && bill.paid) ok(`paid (${paid.hash}); owner moved ${ownerBefore - ownerAfter} uqor`);
  else fail(`not paid: ${JSON.stringify(paid.failed.map((f) => f.attributes))} rawLog=${paid.tx.rawLog.slice(0, 200)}`);
  info(`events: ${[...new Set(paid.tx.events.map((e) => e.type))].join(", ")}`);
  info(`owner window still live: ${(await readAccount("testnet", owner.address)).window?.live ?? false}`);

  step(6, "Attack: send the whole balance to an outside address");
  const drain = await agentExecuteEvm({
    agentPrivateKey: agentKey, account: owner.address, relayer: relayer.address, chainId: net.chainId,
    to: "0x000000000000000000000000000000000000dEaD", valueUqor: ownerAfter - 1_000_000n, nonce: await nonceOf(), digestVersion,
  });
  const d = await relay(relayer, drain, "fenestella agent: drain attempt");
  if (d.failed.length > 0) ok(`refused by the chain (${d.hash}): ${JSON.stringify(d.failed[0].attributes).slice(0, 220)}`);
  else fail(`ACCEPTED: ${d.hash}`);

  step(7, "Attack: call another contract (fUSD transfer)");
  const transfer = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256) returns (bool)"]), functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 1n] });
  const other = await agentExecuteEvm({
    agentPrivateKey: agentKey, account: owner.address, relayer: relayer.address, chainId: net.chainId,
    to: FUSD, data: transfer, nonce: await nonceOf(), digestVersion,
  });
  const o = await relay(relayer, other, "fenestella agent: off-list call");
  if (o.failed.length > 0) ok(`refused by the chain (${o.hash}): ${JSON.stringify(o.failed[0].attributes).slice(0, 220)}`);
  else fail(`ACCEPTED: ${o.hash}`);

  const end = BigInt((await readAccount("testnet", owner.address)).balanceUqor);
  console.log(`\nOwner balance: ${ownerBefore} -> ${end} uqor`);
  void decodeEventLog;
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exitCode = 1;
});
