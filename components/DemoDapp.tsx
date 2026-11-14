"use client";

import { useState } from "react";
import { FenestellaError, requestWindow, type GrantedWindow } from "@fenestella/connect";
import { uqorToQor } from "@/lib/format";

const SNIPPET = `import { requestWindow } from "@fenestella/connect";

const granted = await requestWindow({
  reason: "Pay this month's invoices from the Bills contract.",
  allowedTargets: ["0xYourContract"],
  maxTxs: 10,
  maxValueUqor: "2000000", // 2 QOR, value plus fees
  blocks: 1200,            // about an hour
  network: "testnet",
});

// granted.window is what the chain now reports for the account.
// Send your EVM transactions; the chain refuses anything outside it.`;

/** A stand-in dApp: it holds no key and asks Fenestella for a scoped window. */
export function DemoDapp() {
  const [target, setTarget] = useState("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
  const [result, setResult] = useState<GrantedWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await requestWindow({
          reason: "Demo dApp: make up to 3 calls to one contract in the next 10 minutes.",
          allowedTargets: [target.trim()],
          maxTxs: 3,
          maxValueUqor: "500000",
          blocks: 190,
          network: "testnet",
          fenestellaUrl: window.location.origin,
        }),
      );
    } catch (err) {
      setError(
        err instanceof FenestellaError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "The request failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cols" style={{ marginTop: 24 }}>
      <section className="card stack">
        <h3>Try it</h3>
        <p>
          This page plays the dApp. It asks for 3 transactions, 0.5 QOR, about 10 minutes, to the one address below (the
          testnet fUSD token by default).
        </p>
        <div className="field">
          <label htmlFor="demo-target">Contract the dApp needs</label>
          <input
            id="demo-target"
            className="input mono"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div>
          <button className="btn" onClick={ask} disabled={busy}>
            {busy ? "Waiting for your decision…" : "Request a window"}
          </button>
        </div>
        {error && (
          <div className="notice err" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="notice ok" role="status">
            Granted to <span className="mono">{result.evmAddress}</span>: {result.window.remainingTxs} transactions,{" "}
            {uqorToQor(result.window.remainingValue)} QOR, {result.window.remainingBlocks} blocks, targets{" "}
            <span className="mono">{result.window.allowedTargets.join(" ") || "any"}</span>. Transaction{" "}
            <span className="mono">{result.txHash}</span>.
          </div>
        )}
      </section>
      <section className="card stack">
        <h3>The whole integration</h3>
        <pre className="cli">{SNIPPET}</pre>
        <p>
          The caller never chooses what the user sees: Fenestella restates the bounds in words, shows the origin the
          browser reports, and returns the window as the chain stores it. Use <code>windowCovers()</code> to skip the
          request when a suitable window is already open.
        </p>
      </section>
    </div>
  );
}
