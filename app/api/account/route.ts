import { NextResponse } from "next/server";
import { AddressError, readAccount } from "@/lib/chain/read";
import { assessExposure } from "@/lib/exposure";
import { isNetworkId } from "@/lib/networks";

export const dynamic = "force-dynamic";

/** GET /api/account?address=qor1…|0x…&network=testnet|mainnet */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  const network = url.searchParams.get("network") ?? "testnet";
  if (!isNetworkId(network)) {
    return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  }
  try {
    const truth = await readAccount(network, address);
    return NextResponse.json(
      { truth, exposure: assessExposure(truth) },
      { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
    );
  } catch (err) {
    if (err instanceof AddressError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The chain could not be read. Try again." }, { status: 502 });
  }
}
