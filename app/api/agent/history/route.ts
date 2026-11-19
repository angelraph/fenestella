import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { loadOwnerHistory } from "@/lib/site-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?owner=qor1…: what the agent did for this account, and what the owner did to it, from the chain. */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  if (!owner.startsWith("qor1") || !isValidBech32(owner, "qor")) {
    return NextResponse.json({ error: "Send owner=qor1…" }, { status: 400 });
  }
  try {
    const items = await loadOwnerHistory(owner);
    return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The chain could not be read just now." }, { status: 502 });
  }
}
