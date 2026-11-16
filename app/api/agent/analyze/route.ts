import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { allow } from "@/lib/agent/limit";
import { analyzeInvoice, sampleInvoices } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?ownerEvm=0x…: three demo invoices built from the owner's newest unpaid bill. */
export async function GET(request: Request) {
  const ownerEvm = new URL(request.url).searchParams.get("ownerEvm") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(ownerEvm)) return NextResponse.json({ error: "A 0x address is needed." }, { status: 400 });
  try {
    return NextResponse.json({ samples: await sampleInvoices(ownerEvm) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unavailable." }, { status: 503 });
  }
}

/** POST { owner, invoice }: the agent's AI reads the invoice, checks the chain with tools, and decides. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { owner?: string; invoice?: string };
  if (!body.owner || !isValidBech32(body.owner, "qor")) return NextResponse.json({ error: "A qor1 address is needed." }, { status: 400 });
  const invoice = typeof body.invoice === "string" ? body.invoice.trim() : "";
  if (invoice.length < 10 || invoice.length > 6000) {
    return NextResponse.json({ error: "Paste an invoice of 10 to 6,000 characters." }, { status: 400 });
  }
  const wait = allow(`analyze:${body.owner}`, 8_000, 120);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  try {
    return NextResponse.json(await analyzeInvoice(body.owner, invoice));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The AI could not review this." }, { status: 502 });
  }
}
