/**
 * Renew the demo account's agent links (the chain caps a linked key at 30 days).
 *
 *   npx tsx scripts/renew-links.ts [account=demo3] [days=30]
 *
 * Re-links, in one owner-signed transaction, both agents that work for the
 * account: Fenestella's hosted bill payer and the MCP agent (keys in .keys/).
 * A key that is still linked is revoked and linked again in the same
 * transaction, so there is no moment without a leash and no moment with two.
 */
import { keccak256, concat, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fetchAuthNonce } from "@qorechain/sdk";
import { readAccount } from "../lib/chain/read";
import { agentLinkProof, linkAgentMessagesFromProof, revokeAgentMessage } from "../lib/agent/leash";
import { PAY_BILL_SELECTOR, VAULT } from "../lib/agent/vault";
import type { ChainMessage } from "../lib/signer/types";
import { loadKey, net, signerFor } from "./lib-accounts";
import { ok } from "./lib";
import { readFileSync } from "node:fs";

const name = process.argv[2] ?? "demo3";
const days = Math.min(30, Number(process.argv[3] ?? "30"));

const hostedKey = (master: Hex, owner: string) => keccak256(concat([toBytes("fenestella-agent-key|"), toBytes(master), toBytes(owner)]));
const mcpKey = (master: Hex, owner: string) => keccak256(concat([toBytes("fenestella-mcp-agent|"), toBytes(master), toBytes(owner)]));

async function main() {
  const owner = await signerFor(name);
  const agents: { label: string; key: Hex }[] = [
    { label: "Fenestella bill payer", key: hostedKey(readFileSync(".keys/agent.key", "utf8").trim() as Hex, owner.address) },
    { label: "Own agent (MCP)", key: mcpKey(loadKey("mcp-agent"), owner.address) },
  ];
  const expiryUnix = Math.floor(Date.now() / 1000) + days * 86400 - 300;
  const msgs: ChainMessage[] = [];
  for (const a of agents) {
    const addr = privateKeyToAccount(a.key).address;
    const n = await fetchAuthNonce({ rest: net.rest, address: owner.address, pubkey: addr });
    if (n.linked) msgs.push(revokeAgentMessage(owner.address, addr));
    msgs.push(
      ...linkAgentMessagesFromProof({
        owner: owner.address,
        chainId: net.chainId,
        proof: agentLinkProof(a.key, owner.address, net.chainId),
        terms: { bills: VAULT, selector: PAY_BILL_SELECTOR, perTxUqor: 1n, dailyUqor: 1n, expiryUnix, label: a.label },
      }),
    );
  }
  const r = await owner.signAndBroadcast(msgs, `fenestella: renew agent links for ${days} days`);
  ok(`renewed ${agents.length} agent links on ${name} until ${new Date(expiryUnix * 1000).toISOString()} (${r.txHash})`);
  await new Promise((res) => setTimeout(res, 6000));
  const t = await readAccount("testnet", owner.address);
  for (const a of agents) {
    const hex = privateKeyToAccount(a.key).address.slice(2).toLowerCase();
    const k = t.abstractAccount.authenticators.find((x) => x.pubkeyHex.toLowerCase() === hex);
    ok(`${a.label}: ${k && !k.revoked ? `linked until ${new Date(Number(k.expiryUnix) * 1000).toISOString()}` : "NOT LINKED"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
