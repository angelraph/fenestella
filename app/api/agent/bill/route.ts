import { NextResponse } from "next/server";
import { allow } from "@/lib/agent/limit";
import { postTestBill } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { ownerEvm, amountUqor }: the test vendor posts a bill payable by ownerEvm. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ownerEvm?: string; amountUqor?: string };
  if (!body.ownerEvm || !/^0x[0-9a-fA-F]{40}$/.test(body.ownerEvm)) {
    return NextResponse.json({ error: "A 0x address is needed." }, { status: 400 });
  }
  const amount = /^\d+$/.test(body.amountUqor ?? "") ? BigInt(body.amountUqor!) : 400_000n;
  const wait = allow(`bill:${body.ownerEvm.toLowerCase()}`, 30_000, 40);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  try {
    return NextResponse.json(await postTestBill(body.ownerEvm, amount));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The bill could not be posted." }, { status: 502 });
  }
}
