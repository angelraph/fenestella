"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NetworkId } from "@/lib/networks";
import { useWallet } from "./Wallet";

const ADDRESS = /^(qor1[0-9a-z]{38,58}|0x[0-9a-fA-F]{40})$/;

export function Lookup() {
  const router = useRouter();
  const wallet = useWallet();
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<NetworkId>("testnet");
  const [error, setError] = useState<string | null>(null);

  const go = (addr: string, net: NetworkId = network) => router.push(`/account/${addr}?network=${net}`);

  return (
    <div className="lookup-card">
      <div className="row between">
        <div className="seg" role="group" aria-label="Network">
          {(["testnet", "mainnet"] as const).map((n) => (
            <button key={n} type="button" aria-pressed={network === n} onClick={() => setNetwork(n)}>
              {n === "testnet" ? "Testnet" : "Mainnet"}
            </button>
          ))}
        </div>
        <span className="faint">Read-only. Nothing is signed.</span>
      </div>
      <form
        className="lookup"
        onSubmit={(e) => {
          e.preventDefault();
          const a = address.trim();
          if (!ADDRESS.test(a)) {
            setError("Enter a QoreChain address: qor1… or 0x… (20 bytes).");
            return;
          }
          setError(null);
          go(a);
        }}
      >
        <input
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="qor1… or 0x…"
          aria-label="Account address"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn accent" type="submit">
          Read account
        </button>
      </form>
      <div className="or">OR</div>
      <button
        className="btn"
        type="button"
        disabled={wallet.busy}
        onClick={async () => {
          const s = wallet.signer ?? (await wallet.connectQorex(network));
          if (s) go(s.address, s.network);
        }}
      >
        {wallet.signer ? "Open my account" : wallet.busy ? "Connecting…" : "Connect QoreX"}
      </button>
      {(error || wallet.error) && (
        <div className="notice err" role="alert">
          {error ?? wallet.error}
          {wallet.qorexMissing && (
            <>
              {" "}
              <a href="https://qorechain.io/qorex" target="_blank" rel="noreferrer">
                Get QoreX
              </a>
              . You can still read any account by address.
            </>
          )}
        </div>
      )}
    </div>
  );
}
