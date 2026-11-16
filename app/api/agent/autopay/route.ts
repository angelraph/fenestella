import { NextResponse } from "next/server";
import { isValidBech32 } from "@qorechain/sdk";
import { allow } from "@/lib/agent/limit";
import { autopayState, runAutopay, runAutopayAll } from "@/lib/agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET ?owner=qor1…   the autopay permissions in force for an owner.
 * GET                the scheduled round, for every owner (Vercel cron, GitHub Actions).
 *
 * A round can only pay bills that owners put on autopay with a post-quantum
 * signature, that their vault allows and that the AI approves, so it is safe
 * to trigger. It is still limited to one round every ten minutes, and when
 * CRON_SECRET is set it also needs `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("owner");
  try {
    if (owner) {
      if (!isValidBech32(owner, "qor")) return NextResponse.json({ error: "A qor1 address is needed." }, { status: 400 });
      return NextResponse.json({ autopays: await autopayState(owner) }, { headers: { "cache-control": "no-store" } });
    }
    const secret = process.env.CRON_SECRET;
    if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not allowed." }, { status: 401 });
    }
    const wait = allow("autopay:round", 600_000, 6);
    if (wait) return NextResponse.json({ skipped: true, reason: wait }, { status: 200 });
    const rounds = await runAutopayAll();
    return NextResponse.json({ ranAt: new Date().toISOString(), owners: rounds.length, rounds });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Autopay is unavailable." }, { status: 503 });
  }
}

/** POST { owner }: run one autopay round for this owner now. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { owner?: string };
  if (!body.owner || !isValidBech32(body.owner, "qor")) return NextResponse.json({ error: "A qor1 address is needed." }, { status: 400 });
  const wait = allow(`autopay:${body.owner}`, 20_000, 40);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  return NextResponse.json({ steps: await runAutopay(body.owner, "owner") });
}
