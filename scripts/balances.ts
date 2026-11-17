/** Balances of the project's own testnet accounts: npx tsx scripts/balances.ts */
import { readAccount } from "../lib/chain/read";
import { uqorToQor } from "../lib/format";
import { signerFor } from "./lib-accounts";

for (const name of ["dev", "demo", "demo2", "demo3", "relayer", "vendor", "e2e"]) {
  try {
    const s = await signerFor(name);
    const t = await readAccount("testnet", s.address);
    console.log(`${name.padEnd(8)} ${s.address}  ${uqorToQor(t.balanceUqor)} QOR`);
  } catch (e) {
    console.log(`${name.padEnd(8)} unreadable: ${e instanceof Error ? e.message : e}`);
  }
}
