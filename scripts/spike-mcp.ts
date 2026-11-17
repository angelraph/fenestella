/**
 * The Fenestella MCP server, end to end on testnet, through a real MCP client.
 *
 *   npx tsx scripts/spike-mcp.ts [siteUrl] [owner]
 *
 *  1. Starts packages/mcp/dist/index.js over stdio with a fresh agent master key.
 *  2. Calls the read tools: check_account, qday_radar, vault_status, list_bills, request_window.
 *  3. link_agent: the owner (a test account) links the agent's key on the vault leash.
 *  4. The owner tops up the vault if needed; the test vendor posts a bill.
 *  5. pay_bill: the agent signs payBill on this machine; Fenestella's relayer broadcasts it.
 *  6. pay_bill on a bill from a payee the owner never approved: refused, no fee spent.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readAccount } from "../lib/chain/read";
import { closeWindowMessage, openWindowMessage } from "../lib/messages";
import { createAbstractAccountMessage, linkAgentMessagesFromProof } from "../lib/agent/leash";
import { NATIVE, VAULT, VAULT_ABI } from "../lib/agent/vault";
import { chain, loadKey, publicClient, signerFor } from "./lib-accounts";
import { info, ok } from "./lib";

const site = process.argv[2] ?? "https://fenestella.vercel.app";
const ownerName = process.argv[3] ?? "demo3";
const QOR = 1_000_000_000_000_000_000n;

const fromHex = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g)!.map((b) => parseInt(b, 16)));

async function main() {
  const owner = await signerFor(ownerName);
  const ownerEvm = owner.evmAddress.toLowerCase() as Hex;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["packages/mcp/dist/index.js"],
    env: { ...(process.env as Record<string, string>), FENESTELLA_AGENT_KEY: loadKey("mcp-agent"), FENESTELLA_URL: site },
  });
  const client = new Client({ name: "fenestella-spike", version: "0.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  ok(`MCP tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const t = r.content.map((c) => c.text).join("\n");
    console.log(`\n── ${name} ${JSON.stringify(args)}${r.isError ? " (error)" : ""}\n${t}`);
    return t;
  };

  await call("check_account", { address: owner.address, network: "testnet" });
  await call("qday_radar", { network: "mainnet" });
  await call("vault_status", { owner: owner.address });
  await call("request_window", { reason: "Swap 0.2 QOR on the test AMM", targets: [VAULT], maxTxs: 2, maxValueQor: "0.3", minutes: 30, account: owner.address });

  // 3. leash the agent
  const linkText = await call("link_agent", { owner: owner.address });
  const m = linkText.match(/agent=(0x[0-9a-f]{40})&proof=(0x[0-9a-f]+)/);
  if (m) {
    const t = await readAccount("testnet", owner.address);
    const r = await owner.signAndBroadcast(
      [
        ...(t.abstractAccount.account ? [] : [createAbstractAccountMessage(owner.address)]),
        ...linkAgentMessagesFromProof({
          owner: owner.address,
          chainId: "qorechain-diana",
          proof: { pubkey: fromHex(m[1]), possessionProof: fromHex(m[2]) },
          terms: { bills: VAULT, selector: "0xf0975190", perTxUqor: 1n, dailyUqor: 1n, expiryUnix: Math.floor(Date.now() / 1000) + 29 * 86400, label: "Own agent (MCP)" },
        }),
      ],
      "fenestella: link my own agent (MCP)",
    );
    ok(`owner linked the MCP agent ${m[1]} (${r.txHash})`);
    await new Promise((res) => setTimeout(res, 6000));
  } else {
    info("agent already linked");
  }

  // 4. money in the vault, and a bill from the approved vendor
  const bal = await publicClient.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "balanceOf", args: [ownerEvm, NATIVE] });
  if (bal < QOR / 2n) {
    await owner.signAndBroadcast([openWindowMessage(owner.address, { blocks: 120, maxTxs: 1, maxValueUqor: "1200000", allowedTargets: [VAULT] })], "fenestella: deposit window");
    const wallet = createWalletClient({ account: privateKeyToAccount(owner.account.privateKey as Hex), chain, transport: http(chain.rpcUrls.default.http[0]) });
    const hash = await wallet.sendTransaction({ to: VAULT, value: QOR, gas: 120_000n, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [ownerEvm] }) });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    ok(`owner put 1 QOR in the vault (${hash})`);
    const w = (await readAccount("testnet", owner.address)).window;
    if (w?.live) await owner.signAndBroadcast([closeWindowMessage(owner.address)], "fenestella: close deposit window");
  }
  const vendor = await signerFor("vendor", 400_000, "40000");
  await vendor.signAndBroadcast([openWindowMessage(vendor.address, { blocks: 120, maxTxs: 1, maxValueUqor: "500000", allowedTargets: [VAULT] })], "vendor: bill window");
  const vw = createWalletClient({ account: privateKeyToAccount(vendor.account.privateKey as Hex), chain, transport: http(chain.rpcUrls.default.http[0]) });
  const billHash = await vw.writeContract({
    address: VAULT, abi: VAULT_ABI, functionName: "createBill",
    args: [ownerEvm, NATIVE, 150_000n * 1_000_000_000_000n, `0x${"ab".repeat(32)}` as Hex],
  });
  const rc = await publicClient.waitForTransactionReceipt({ hash: billHash, timeout: 90_000 });
  const billId = BigInt(rc.logs.find((l) => l.address.toLowerCase() === VAULT && l.topics.length === 4)!.topics[1]!).toString();
  ok(`vendor posted bill #${billId} for 0.15 QOR (${billHash})`);
  const vwin = (await readAccount("testnet", vendor.address)).window;
  if (vwin?.live) await vendor.signAndBroadcast([closeWindowMessage(vendor.address)], "vendor: close window");

  // 5 and 6
  const bills = await call("list_bills", { owner: owner.address });
  await call("pay_bill", { owner: owner.address, billId });
  const refused = bills.match(/#(\d+): [\d.]+ QOR to 0x[0-9a-f]+: refused, the payee is not one/);
  if (refused) await call("pay_bill", { owner: owner.address, billId: refused[1] });
  await call("vault_status", { owner: owner.address });
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
