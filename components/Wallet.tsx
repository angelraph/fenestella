"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { browserEndpoints, type NetworkId } from "@/lib/networks";
import { shortAddress } from "@/lib/format";
import type { Signer } from "@/lib/signer/types";

interface WalletState {
  signer: Signer | null;
  busy: boolean;
  error: string | null;
  qorexMissing: boolean;
  connectQorex(network: NetworkId): Promise<Signer | null>;
  connectLocal(mnemonic: string): Promise<Signer | null>;
  disconnect(): void;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet needs WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qorexMissing, setQorexMissing] = useState(false);

  const connectQorex = useCallback(async (network: NetworkId) => {
    setBusy(true);
    setError(null);
    setQorexMissing(false);
    try {
      const mod = await import("@/lib/signer/qorex");
      const s = await mod.connectQorex(network);
      setSigner(s);
      return s;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "not-installed") setQorexMissing(true);
      setError(err instanceof Error ? err.message : "Could not connect QoreX.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const connectLocal = useCallback(async (mnemonic: string) => {
    setBusy(true);
    setError(null);
    try {
      const mod = await import("@/lib/signer/local");
      const s = await mod.LocalSigner.fromMnemonic("testnet", mnemonic, { rest: browserEndpoints("testnet").rest });
      setSigner(s);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That recovery phrase could not be used.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSigner(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({ signer, busy, error, qorexMissing, connectQorex, connectLocal, disconnect }),
    [signer, busy, error, qorexMissing, connectQorex, connectLocal, disconnect],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * Connect controls. QoreX is the way in. The testnet key option is for
 * development only and is kept behind a disclosure, with the reason stated.
 */
export function ConnectPanel({ network, onConnected }: { network: NetworkId; onConnected?: (s: Signer) => void }) {
  const w = useWallet();
  const [showLocal, setShowLocal] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  if (w.signer) {
    return (
      <div className="row between">
        <span className="muted">
          <span className="dot good" />
          {w.signer.label}: <span className="mono">{shortAddress(w.signer.address)}</span>
          {w.signer.network !== network && " (connected on the other network)"}
        </span>
        <button className="btn ghost small" onClick={w.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn"
          disabled={w.busy}
          onClick={async () => {
            const s = await w.connectQorex(network);
            if (s) onConnected?.(s);
          }}
        >
          {w.busy ? "Connecting…" : "Connect QoreX"}
        </button>
        {network === "testnet" && (
          <button className="btn ghost small" onClick={() => setShowLocal((v) => !v)} aria-expanded={showLocal}>
            Use a testnet key instead
          </button>
        )}
      </div>
      {w.error && (
        <div className="notice err" role="alert">
          {w.error}
          {w.qorexMissing && (
            <>
              {" "}
              <a href="https://qorechain.io/qorex" target="_blank" rel="noreferrer">
                Get QoreX
              </a>
              , switch it to {network === "testnet" ? "Testnet" : "Mainnet"}, and reload.
            </>
          )}
        </div>
      )}
      {showLocal && network === "testnet" && (
        <div className="card stack">
          <p>
            For development. Paste the recovery phrase of a <strong>throwaway testnet account</strong>. It stays in this
            tab&apos;s memory, is never stored or sent anywhere, and is gone when you reload. Never paste a phrase that
            guards real funds.
          </p>
          <textarea
            className="input"
            rows={2}
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            placeholder="twelve or twenty-four words"
            autoComplete="off"
            spellCheck={false}
            aria-label="Testnet recovery phrase"
          />
          <div>
            <button
              className="btn small"
              disabled={w.busy || mnemonic.trim().split(/\s+/).length < 12}
              onClick={async () => {
                const s = await w.connectLocal(mnemonic);
                if (s) {
                  setMnemonic("");
                  onConnected?.(s);
                }
              }}
            >
              Use this testnet key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
