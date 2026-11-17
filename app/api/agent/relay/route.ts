import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { allow } from "@/lib/agent/limit";
import { MandateError } from "@/lib/agent/mandate";
import { relayOwnAgentPayment } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cors = { "access-control-allow-origin": "*" };

/**
 * POST { owner, agent, billId, nonce, gasLimit, digestVersion, signature }
 *
 * For agents the owner runs themself (the Fenestella MCP server): the agent
 * signs one `payBill` call on its own machine and this relayer broadcasts it
 * and pays the fee. It relays nothing else.
 */
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ok =
    typeof b.owner === "string" && b.owner.startsWith("qor1") && isValidBech32(b.owner, "qor") &&
    typeof b.agent === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.agent) &&
    typeof b.billId === "string" && /^\d{1,12}$/.test(b.billId) &&
    typeof b.nonce === "string" && /^\d{1,18}$/.test(b.nonce) &&
    typeof b.gasLimit === "number" && Number.isInteger(b.gasLimit) && b.gasLimit >= 50_000 && b.gasLimit <= 400_000 &&
    (b.digestVersion === "v1" || b.digestVersion === "v2") &&
    typeof b.signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(b.signature);
  if (!ok) {
    return NextResponse.json({ error: "Send owner (qor1…), agent (0x…), billId, nonce, gasLimit, digestVersion and the agent's 65-byte signature." }, { status: 400, headers: cors });
  }
  const wait = allow(`relay:${b.owner}`, 20_000, 40);
  if (wait) return NextResponse.json({ error: wait }, { status: 429, headers: cors });
  try {
    const r = await relayOwnAgentPayment({
      owner: b.owner as string,
      agent: b.agent as `0x${string}`,
      billId: BigInt(b.billId as string),
      nonce: BigInt(b.nonce as string),
      gasLimit: b.gasLimit as number,
      digestVersion: b.digestVersion as "v1" | "v2",
      signature: b.signature as `0x${string}`,
    });
    return NextResponse.json(r, { headers: cors });
  } catch (err) {
    const known = err instanceof MandateError;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: known ? 400 : 502, headers: cors });
  }
}
