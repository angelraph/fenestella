import { NextResponse } from "next/server";
import { agentInfo, billsFor } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent[?ownerEvm=0x…]: who the agent is, and the owner's bills. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const owner = params.get("owner");
    const evmParam = params.get("ownerEvm");
    const ownerEvm = evmParam && /^0x[0-9a-fA-F]{40}$/.test(evmParam) ? evmParam : undefined;
    const info = await agentInfo(owner && /^qor1[0-9a-z]{38,58}$/.test(owner) ? owner : undefined, ownerEvm);
    const ownerBills = ownerEvm ? await billsFor(ownerEvm) : [];
    return NextResponse.json({ ...info, ownerBills }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The agent is unavailable." }, { status: 503 });
  }
}
