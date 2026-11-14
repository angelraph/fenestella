"use client";

import Link from "next/link";
import { shortAddress } from "@/lib/format";
import { useWallet } from "./Wallet";

/** The wallet cluster in the header: connect, or the connected account. */
export function HeaderWallet() {
  const w = useWallet();
  return (
    <div className="header-right">
      <span className="chip net">
        <span className="dot good" style={{ marginRight: 0 }} />
        Testnet
      </span>
      {w.signer ? (
        <>
          <Link className="chip" href={`/account/${w.signer.address}?network=${w.signer.network}`}>
            <span className="mono">{shortAddress(w.signer.address, 7, 5)}</span>
          </Link>
          <button className="btn ghost small" onClick={w.disconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button className="btn small" disabled={w.busy} onClick={() => void w.connectQorex("testnet")}>
          {w.busy ? "Connecting…" : "Connect QoreX"}
        </button>
      )}
    </div>
  );
}
