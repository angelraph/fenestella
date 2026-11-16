/**
 * Two small native features on the dev account (a project address):
 *  1. publish its ML-KEM-1024 encryption key in the chain's KEM registry, so
 *     anyone can seal a QoreSeal message to it by address;
 *  2. one swap on the native AMM (0.1 QOR for fUSD, pool 2).
 *
 *   npx tsx scripts/kem-and-swap.ts
 */
import { fetchKemKey, KEM_ALGORITHM_ML_KEM_1024, msg } from "@qorechain/sdk";
import { deriveSealKeys } from "@qorechain/qoreseal";
import { readFileSync } from "node:fs";
import { readAccount } from "../lib/chain/read";
import { NETWORKS } from "../lib/networks";
import { signerFor } from "./lib-accounts";
import { info, ok, step } from "./lib";

const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const rest = NETWORKS.testnet.rest;

const dev = await signerFor("dev");
const bal = BigInt((await readAccount("testnet", dev.address)).balanceUqor);
if (bal < 600_000n) {
  step(0, "Top up the dev account for fees");
  const demo = await signerFor("demo");
  const r = await demo.signAndBroadcast(
    [msg.bank.send({ fromAddress: demo.address, toAddress: dev.address, amount: [{ denom: "uqor", amount: "1000000" }] })],
    "fenestella: fees for dev",
  );
  ok(`sent 1 QOR from demo (${r.txHash})`);
}

step(1, "Publish the dev account's ML-KEM-1024 key");
const existing = await fetchKemKey({ rest, address: dev.address }).catch(() => null);
const keys = deriveSealKeys({ mnemonic: readFileSync(".keys/dev.mnemonic", "utf8").trim() });
if (existing && "publicKey" in existing && existing.publicKey) {
  info("already published");
} else {
  const r = await dev.signAndBroadcast(
    [msg.pqc.registerKemKey({ sender: dev.address, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: keys.mlkemPublicKey })],
    "fenestella: publish encryption key",
  );
  ok(`registered (${r.txHash})`);
}

step(2, "Swap 0.1 QOR for fUSD on the native AMM (pool 2)");
const s = await dev.signAndBroadcast(
  [msg.amm.swapExactIn({ sender: dev.address, poolId: "2", tokenIn: { denom: "uqor", amount: "100000" }, denomOut: FUSD, minOut: "1" })],
  "fenestella: one AMM swap",
);
ok(`swapped (${s.txHash})`);
