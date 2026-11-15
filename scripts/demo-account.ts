/**
 * A fresh testnet account for recording the demo: funded from the dev
 * account, post-quantum key registered, nothing else. Kept in
 * .keys/demo.mnemonic (git-ignored).
 *   npx tsx scripts/demo-account.ts
 */
import { readAccount } from "../lib/chain/read";
import { ensureReady, signerFor } from "./lib-accounts";
import { info } from "./lib";

const s = await signerFor(process.argv[2] ?? "demo");
await ensureReady(s, 5_000_000n, "demo");
const t = await readAccount("testnet", s.address);
info(`demo ${s.address} ${s.evmAddress}: ${t.balanceUqor} uqor, key ${t.pqc.registered}, window ${t.window?.live ?? false}`);
