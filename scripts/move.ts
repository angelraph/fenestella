/**
 * Move test QOR between the project's own testnet accounts.
 *   npx tsx scripts/move.ts <from> <to> <qor>      e.g. vendor relayer 2.5
 */
import { msg } from "@qorechain/sdk";
import { qorToUqor } from "../lib/format";
import { signerFor } from "./lib-accounts";
import { ok } from "./lib";

const [from, to, qor] = process.argv.slice(2);
if (!from || !to || !qor) throw new Error("usage: move.ts <from> <to> <qor>");
const a = await signerFor(from);
const b = await signerFor(to);
const r = await a.signAndBroadcast(
  [msg.bank.send({ fromAddress: a.address, toAddress: b.address, amount: [{ denom: "uqor", amount: qorToUqor(qor).toString() }] })],
  `fenestella: test funds ${from} -> ${to}`,
);
ok(`${from} -> ${to}: ${qor} QOR (${r.txHash})`);
