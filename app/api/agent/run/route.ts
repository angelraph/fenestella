import { NextResponse } from "next/server";
import { allow } from "@/lib/agent/limit";
import type { MandateTerms } from "@/lib/agent/mandate";
import { runMandate } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { envelope, anchorTx, terms }: hand a sealed, anchored mandate to the agent. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { envelope?: string; anchorTx?: string; terms?: MandateTerms };
  if (
    typeof body.envelope !== "string" ||
    !body.envelope.startsWith("qoreseal:") ||
    body.envelope.length > 20_000 ||
    typeof body.anchorTx !== "string" ||
    !/^[0-9A-Fa-f]{64}$/.test(body.anchorTx) ||
    !body.terms ||
    typeof body.terms.owner !== "string"
  ) {
    return NextResponse.json({ error: "Send a sealed envelope, the anchor transaction hash and the mandate terms." }, { status: 400 });
  }
  const wait = allow(`run:${body.terms.owner}`, 15_000, 60);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  return NextResponse.json({ steps: await runMandate({ envelope: body.envelope, anchorTx: body.anchorTx, terms: body.terms }) });
}
