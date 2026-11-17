import { NextResponse } from "next/server";
import { loadActivity } from "@/lib/site-data";

export const runtime = "nodejs";
export const revalidate = 60;

/** GET: the newest agent payments and refused attacks, as the chain recorded them. */
export async function GET() {
  const items = await loadActivity(8);
  return NextResponse.json({ items }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
