/**
 * Spike 1: the whole window lifecycle on qorechain-diana with a local key.
 *
 *   npm run spike
 *
 * Registers the ML-DSA-87 key (with proof of possession), opens a window
 * scoped to one target, reads it back, closes it, and prints what the chain
 * says at each step. The first run creates a throwaway key and stops so you
 * can fund it from the faucet.
 */
import { assessExposure } from "../lib/exposure";
import { readAccount } from "../lib/chain/read";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { LocalSigner } from "../lib/signer/local";
import { FAUCET, fail, info, loadMnemonic, ok, step } from "./lib";

const TARGET = process.env.FENESTELLA_TARGET ?? "0x97143B771D34ddb9130b807b135Ae675A5a963CA"; // testnet fUSD

async function show(address: string) {
  const truth = await readAccount("testnet", address);
  const x = assessExposure(truth);
  info(`exposure: ${x.level} - ${x.headline}`);
  return truth;
}

async function main() {
  const { mnemonic, created } = loadMnemonic();
  const signer = await LocalSigner.fromMnemonic("testnet", mnemonic);
  console.log(`Account  ${signer.address}\n         ${signer.evmAddress}`);
  if (created) console.log("A new throwaway key was written to .keys/dev.mnemonic (git-ignored).");

  step(1, "Account is funded");
  const state = await signer.accountState();
  if (!state.exists) {
    fail("not on chain yet");
    info(`Send test QOR to ${signer.address} from ${FAUCET}, then run this again.`);
    process.exitCode = 2;
    return;
  }
  ok(`account number ${state.accountNumber}, sequence ${state.sequence}`);
  await show(signer.address);

  step(2, "Post-quantum key is registered");
  if (await signer.isPqcRegistered()) {
    ok("already registered");
  } else {
    const r = await signer.registerPqcKey();
    ok(`registered with proof of possession: ${r.txHash}`);
  }
  await show(signer.address);

  step(3, `Open a window scoped to ${TARGET}`);
  const spec = { blocks: 120, maxTxs: 2, maxValueUqor: "200000", allowedTargets: [TARGET] };
  const opened = await signer.signAndBroadcast([openWindowMessage(signer.address, spec)], "fenestella spike: open");
  ok(`opened: ${opened.txHash} at height ${opened.height}`);
  const afterOpen = await show(signer.address);
  const w = afterOpen.window;
  if (!w?.live) fail("the chain does not report a live window");
  else if (w.allowedTargets.map((t) => t.toLowerCase()).join() !== TARGET.toLowerCase()) fail(`targets differ: ${w.allowedTargets}`);
  else ok(`live: ${w.remainingTxs} txs, ${w.remainingValue} uqor, ${w.remainingBlocks} blocks, targets ${w.allowedTargets}`);

  step(4, "Close it");
  const closed = await signer.signAndBroadcast([closeWindowMessage(signer.address)], "fenestella spike: close");
  ok(`closed: ${closed.txHash}`);
  const afterClose = await show(signer.address);
  if (afterClose.window?.live) fail("the window is still live");
  else ok("no live window");
}

main().catch((err) => {
  console.error(`\nStopped: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
