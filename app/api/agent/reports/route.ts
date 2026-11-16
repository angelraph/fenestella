import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, toHex } from "viem";
import { NETWORKS } from "@/lib/networks";
import { agentIdentity, REPORT_PURPOSE, REPORTS, REPORTS_FROM_BLOCK } from "@/lib/agent/reports";
import { labInternals } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const net = NETWORKS.testnet;
const EVENT = parseAbiItem("event Report(address indexed owner, address indexed sender, bytes32 indexed ref, bytes envelope)");
const SPAN = 10_000n;

/**
 * GET ?ownerEvm=0x…: the sealed reports posted to this owner, newest first,
 * and the agent identity's post-quantum public key as the chain stores it, so
 * the owner's browser can open each report and check who signed it.
 */
export async function GET(request: Request) {
  const ownerEvm = new URL(request.url).searchParams.get("ownerEvm") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(ownerEvm)) return NextResponse.json({ error: "A 0x address is needed." }, { status: 400 });
  try {
    const { agentKey } = await labInternals.keys();
    const id = await agentIdentity(agentKey);
    const pq = (await (await fetch(`${net.rest}/qorechain/pqc/v1/account/${id.address}`, { cache: "no-store" })).json()) as { found?: boolean; account?: { public_key?: string } };
    const client = createPublicClient({ transport: http(net.evmRpc) });
    const head = await client.getBlockNumber();
    const spans: [bigint, bigint][] = [];
    for (let f = REPORTS_FROM_BLOCK; f <= head; f += SPAN) spans.push([f, f + SPAN - 1n < head ? f + SPAN - 1n : head]);
    const logs = (
      await Promise.all(
        spans.map(([fromBlock, toBlock]) =>
          client.getLogs({ address: REPORTS, event: EVENT, args: { owner: ownerEvm.toLowerCase() as `0x${string}` }, fromBlock, toBlock }),
        ),
      )
    ).flat();
    const reports = logs
      .filter((l) => l.args.sender?.toLowerCase() === id.evmAddress.toLowerCase())
      .map((l) => ({ tx: l.transactionHash, block: l.blockNumber.toString(), ref: l.args.ref, envelope: l.args.envelope ?? toHex(new Uint8Array()) }))
      .reverse()
      .slice(0, 20);
    return NextResponse.json(
      {
        purpose: REPORT_PURPOSE,
        contract: REPORTS,
        agent: { address: id.address, evm: id.evmAddress.toLowerCase(), pqPublicKey: pq.found ? pq.account?.public_key ?? null : null },
        reports,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reports are unavailable." }, { status: 503 });
  }
}
