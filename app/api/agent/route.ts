import { NextResponse } from "next/server";
import { agentInfo, billsFor } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent[?ownerEvm=0x…]: who the agent is, and the owner's bills. */
export async function GET(request: Request) {
  try {
    const info = await agentInfo();
    const ownerEvm = new URL(request.url).searchParams.get("ownerEvm");
    const ownerBills = ownerEvm && /^0x[0-9a-fA-F]{40}$/.test(ownerEvm) ? await billsFor(ownerEvm) : [];
    return NextResponse.json({ ...info, ownerBills }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The agent is unavailable." }, { status: 503 });
  }
}
