import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { allow } from "@/lib/agent/limit";
import { rogueDrain } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { owner }: play a stolen agent key trying to drain the owner. The chain must refuse it. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { owner?: string };
  if (!body.owner || !isValidBech32(body.owner, "qor")) {
    return NextResponse.json({ error: "A qor1 address is needed." }, { status: 400 });
  }
  const wait = allow(`rogue:${body.owner}`, 30_000, 30);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  return NextResponse.json({ steps: await rogueDrain(body.owner) });
}
