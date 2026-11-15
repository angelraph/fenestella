/**
 * Keep the agent's relayer and the test vendor funded from the dev account.
 *   npx tsx scripts/topup.ts
 */
import { readAccount } from "../lib/chain/read";
import { ensureReady, signerFor } from "./lib-accounts";
import { info } from "./lib";

const targets: [string, bigint][] = [
  ["relayer", 6_000_000n],
  ["vendor", 4_000_000n],
];
for (const [name, min] of targets) {
  const s = await signerFor(name);
  await ensureReady(s, min, name);
  info(`${name} ${s.address}: ${(await readAccount("testnet", s.address)).balanceUqor} uqor`);
}
const dev = await signerFor("dev");
info(`dev ${dev.address}: ${(await readAccount("testnet", dev.address)).balanceUqor} uqor`);
