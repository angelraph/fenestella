"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortAddress } from "@/lib/format";
import { useWallet } from "./Wallet";

/** The wallet cluster in the header: connect, or the connected account. */
export function HeaderWallet() {
  const w = useWallet();
  const router = useRouter();
  return (
    <div className="header-right">
      <span className="chip net">
        <span className="dot good" style={{ marginRight: 0 }} />
        Testnet
      </span>
      {w.active ? (
        <>
          <Link className="chip" href={`/account/${w.active.address}?network=${w.active.network}`} title={w.active.label}>
            <span className={`dot ${w.active.canSign ? "good" : "warn"}`} style={{ marginRight: 0 }} />
            <span className="mono">{shortAddress(w.active.address, 7, 5)}</span>
          </Link>
          <button className="btn ghost small" onClick={w.disconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button
          className="btn small"
          disabled={w.busy}
          onClick={() =>
            void w.pick("testnet").then((a) => a && router.push(`/account/${a.address}?network=${a.network}`))
          }
        >
          {w.busy ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
