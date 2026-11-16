import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { draftPolicy } from "@/lib/agent/ai";
import { allow } from "@/lib/agent/limit";
import { checkPolicy } from "@/lib/agent/policy";
import { labInternals, TEST_VENDOR_NAME } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { owner, text }: the AI drafts vault rules (and autopay) from the
 * owner's own words; Fenestella's rules check the draft. Nothing is signed
 * here: the owner reviews the proposal and signs it in the browser.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { owner?: string; text?: string };
  if (!body.owner || !isValidBech32(body.owner, "qor")) return NextResponse.json({ error: "A qor1 address is needed." }, { status: 400 });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 8 || text.length > 2000) return NextResponse.json({ error: "Describe your rules in 8 to 2,000 characters." }, { status: 400 });
  const wait = allow(`policy:${body.owner}`, 8_000, 120);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  try {
    const { vendor } = await labInternals.keys();
    const known = [{ name: TEST_VENDOR_NAME, address: vendor.evmAddress.toLowerCase() }];
    const { draft, model } = await draftPolicy(text, known);
    return NextResponse.json({ model, summary: draft.summary, proposal: checkPolicy(draft, known) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The AI could not draft rules." }, { status: 502 });
  }
}
