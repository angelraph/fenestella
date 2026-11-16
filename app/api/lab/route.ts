import { NextResponse } from "next/server";
import { allow } from "@/lib/agent/limit";
import { ATTACKS, LAB_OWNER, runAttack } from "@/lib/agent/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET: the attacks the lab can run. */
export async function GET() {
  return NextResponse.json({
    owner: LAB_OWNER,
    attacks: ATTACKS.map(({ id, title, attacker, tries, expected, onChain }) => ({ id, title, attacker, tries, expected, onChain })),
  });
}

/**
 * POST { id }: run one attack live on testnet. Each attack runs at most once
 * every 20 seconds; attacks that send a transaction (the relayer pays the fee)
 * at most 40 times an hour in all.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const attack = ATTACKS.find((a) => a.id === body.id);
  if (!attack) return NextResponse.json({ error: "Unknown attack." }, { status: 400 });
  const wait = allow(`lab:${attack.id}`, 20_000, 60) ?? (attack.onChain ? allow("lab:on-chain", 0, 40) : null);
  if (wait) return NextResponse.json({ error: wait }, { status: 429 });
  return NextResponse.json(await runAttack(attack.id));
}
