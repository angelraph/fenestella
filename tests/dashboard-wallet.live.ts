/**
 * Live check of connectDashboardWallet against testnet, using the dev key.
 *   npx tsx tests/dashboard-wallet.live.ts
 */
import { connectDashboardWallet } from "../lib/signer/local";
import { loadMnemonic } from "../scripts/lib";

const { mnemonic } = loadMnemonic();

const ok = await connectDashboardWallet(mnemonic, "qor18ydtk2rx0wma4csyl9353kj0z29w645daa47z9");
console.log("right address + registered key:", ok.address, ok.label);

try {
  await connectDashboardWallet(mnemonic, "qor1x2fqs3lpczt2yz2q2rvh0mjvft9rse30c5tv07");
  console.log("WRONG: accepted a phrase for another address");
} catch (err) {
  console.log("wrong address refused:", (err as Error).message.slice(0, 90));
}

try {
  await connectDashboardWallet("one two three", "qor18ydtk2rx0wma4csyl9353kj0z29w645daa47z9");
  console.log("WRONG: accepted a short phrase");
} catch (err) {
  console.log("short phrase refused:", (err as Error).message);
}
