import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { allow } from "@/lib/agent/limit";
import { broadcastDeposit, evmTxParams, relayVaultAdmin } from "@/lib/agent/server";
import type { VaultAdmin } from "@/lib/agent/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** GET ?evm=0x…: nonce and gas price, so the browser can sign the owner's deposit. */
export async function GET(request: Request) {
  const evm = new URL(request.url).searchParams.get("evm") ?? "";
  if (!ADDR.test(evm)) return NextResponse.json({ error: "A 0x address is needed." }, { status: 400 });
  try {
    return NextResponse.json(await evmTxParams(evm), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unavailable." }, { status: 503 });
  }
}

type Body =
  | { kind: "deposit"; raw: Hex }
  | { kind: "admin"; ownerEvm: string; items: { admin: Record<string, unknown>; signature: Hex }[] };

/**
 * POST { kind: "deposit", raw }: broadcast the owner's own signed deposit.
 * POST { kind: "admin", ownerEvm, items }: relay actions the owner signed with
 * their ML-DSA-87 key; the vault checks every signature with pqcVerify.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  try {
    if (body.kind === "deposit") {
      if (typeof body.raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.raw)) throw new Error("A signed transaction is needed.");
      return NextResponse.json(await broadcastDeposit(body.raw));
    }
    if (body.kind === "admin") {
      if (!ADDR.test(body.ownerEvm ?? "")) throw new Error("A 0x owner address is needed.");
      const wait = allow(`vault-admin:${body.ownerEvm.toLowerCase()}`, 20_000, 30);
      if (wait) return NextResponse.json({ error: wait }, { status: 429 });
      const items = (body.items ?? []).map((i) => ({ admin: parseAdmin(i.admin), signature: i.signature }));
      if (items.some((i) => !/^0x[0-9a-fA-F]+$/.test(i.signature))) throw new Error("Each action needs its signature.");
      return NextResponse.json({ steps: await relayVaultAdmin(body.ownerEvm, items) });
    }
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The vault request failed." }, { status: 400 });
  }
}

function parseAdmin(a: Record<string, unknown>): VaultAdmin {
  const addr = (v: unknown) => {
    if (typeof v !== "string" || !ADDR.test(v)) throw new Error("Bad address in a vault action.");
    return v.toLowerCase() as Hex;
  };
  const big = (v: unknown) => {
    if (typeof v !== "string" || !/^\d{1,40}$/.test(v)) throw new Error("Bad amount in a vault action.");
    return BigInt(v);
  };
  switch (a.action) {
    case "payee":
      return { action: "payee", payee: addr(a.payee), approved: a.approved === true };
    case "limits":
      return { action: "limits", token: addr(a.token), perPayment: big(a.perPayment), perDay: big(a.perDay) };
    case "pause":
      return { action: "pause", paused: a.paused === true };
    case "withdraw":
      return { action: "withdraw", token: addr(a.token), amount: big(a.amount) };
    default:
      throw new Error("Unknown vault action.");
  }
}
