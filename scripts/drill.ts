/**
 * The Q-Day Drill account.
 *
 *   npx tsx scripts/drill.ts setup   create a fresh account, fund it from the dev account,
 *                                    register its ML-DSA-87 key with proof of possession
 *   npx tsx scripts/drill.ts proof   on drill day: one normal hybrid-signed transaction
 *   npx tsx scripts/drill.ts status  what the chain says about the account right now
 *
 * The drill gives this account's CLASSICAL key to an attacker bot and publishes
 * it afterwards. So this is a throwaway testnet account: never fund it with
 * anything that matters and never reuse its phrase. `setup` writes the
 * classical private key to .keys/drill.classical-key.txt (git-ignored) so you
 * can paste it into the fest form yourself. It is never printed.
 *
 * The account keeps NO EVM window open. With the post-quantum key registered
 * and no window, the classical key alone can do nothing, and the proof
 * transaction is a native one that never needs a window.
 */
import { writeFileSync } from "node:fs";
import { msg } from "@qorechain/sdk";
import { readAccount } from "../lib/chain/read";
import { assessExposure } from "../lib/exposure";
import { uqorToQor } from "../lib/format";
import { LocalSigner } from "../lib/signer/local";
import { info, loadMnemonic, ok, step } from "./lib";

const FUND_UQOR = process.env.DRILL_FUND_UQOR ?? "20000000"; // 20 QOR, so "value kept" is not zero

async function drillSigner() {
  const { mnemonic, created } = loadMnemonic("drill");
  return { signer: await LocalSigner.fromMnemonic("testnet", mnemonic), created };
}

async function status(address: string) {
  const truth = await readAccount("testnet", address);
  const x = assessExposure(truth);
  info(`balance ${uqorToQor(truth.balanceUqor)} QOR, key ${truth.pqc.registered ? "registered" : "NOT registered"}${truth.pqc.possessionProven ? " (possession proven)" : ""}, window ${truth.window?.live ? "OPEN" : "closed"}`);
  info(`exposure: ${x.level} - ${x.headline}`);
  return truth;
}

async function setup() {
  const { signer: drill, created } = await drillSigner();
  console.log(`Drill account ${drill.address}\n              ${drill.evmAddress}`);
  if (created) info("new phrase written to .keys/drill.mnemonic (git-ignored)");

  step(1, "Fund it from the dev account");
  const before = await readAccount("testnet", drill.address);
  if (BigInt(before.balanceUqor) >= BigInt(FUND_UQOR) / 2n) {
    ok(`already holds ${uqorToQor(before.balanceUqor)} QOR`);
  } else {
    const dev = await LocalSigner.fromMnemonic("testnet", loadMnemonic().mnemonic);
    const sent = await dev.signAndBroadcast(
      [msg.bank.send({ fromAddress: dev.address, toAddress: drill.address, amount: [{ denom: "uqor", amount: FUND_UQOR }] })],
      "fenestella: fund drill account",
    );
    ok(`sent ${uqorToQor(FUND_UQOR)} QOR: ${sent.txHash}`);
  }

  step(2, "Register its ML-DSA-87 key with proof of possession");
  if (await drill.isPqcRegistered()) ok("already registered");
  else ok(`registered: ${(await drill.registerPqcKey()).txHash}`);

  step(3, "Write the classical key for the fest form");
  writeFileSync(".keys/drill.classical-key.txt", drill.account.privateKey + "\n", { mode: 0o600 });
  ok("written to .keys/drill.classical-key.txt (git-ignored, not printed)");

  step(4, "What the chain says");
  await status(drill.address);
}

async function proof() {
  const { signer: drill } = await drillSigner();
  console.log(`Drill account ${drill.address}`);
  const sent = await drill.signAndBroadcast(
    [msg.bank.send({ fromAddress: drill.address, toAddress: drill.address, amount: [{ denom: "uqor", amount: "1" }] })],
    "fenestella: q-day drill proof, hybrid-signed, window shut",
  );
  ok(`proof transaction: ${sent.txHash} at height ${sent.height}`);
  info("Paste this hash on the project page.");
  await status(drill.address);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "setup") return setup();
  if (cmd === "proof") return proof();
  if (cmd === "status") {
    const { signer } = await drillSigner();
    console.log(`Drill account ${signer.address}\n              ${signer.evmAddress}`);
    await status(signer.address);
    return;
  }
  console.log("Usage: npx tsx scripts/drill.ts setup | proof | status");
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
