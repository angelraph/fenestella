"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { browserEndpoints, type NetworkId } from "@/lib/networks";
import { shortAddress } from "@/lib/format";
import type { Signer } from "@/lib/signer/types";
import type { ConnectedAccount, DetectedWallet } from "@/lib/wallets/detect";

/** The account the page is working with, however it was connected. */
export interface ActiveAccount {
  address: string;
  network: NetworkId;
  label: string;
  /** False for wallets that hold only the classical key: they can show the account, not sign a window. */
  canSign: boolean;
}

interface WalletState {
  signer: Signer | null;
  viewer: ConnectedAccount | null;
  active: ActiveAccount | null;
  busy: boolean;
  error: string | null;
  qorexMissing: boolean;
  connectQorex(network: NetworkId): Promise<Signer | null>;
  connectLocal(mnemonic: string): Promise<Signer | null>;
  /** Open the wallet picker. Resolves with the connected account, or null if dismissed. */
  pick(network: NetworkId): Promise<ActiveAccount | null>;
  disconnect(): void;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet needs WalletProvider");
  return ctx;
}

const QOREX_LINKS = [
  { label: "Chrome, Brave, Edge", href: "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg" },
  { label: "Firefox", href: "https://addons.mozilla.org/firefox/addon/qorex/" },
  { label: "Phone app and web wallet", href: "https://qorechain.io/qorex" },
];

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [viewer, setViewer] = useState<ConnectedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qorexMissing, setQorexMissing] = useState(false);
  const [picker, setPicker] = useState<{ network: NetworkId } | null>(null);
  const [wallets, setWallets] = useState<DetectedWallet[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [dashOpen, setDashOpen] = useState(false);
  const [dashAddress, setDashAddress] = useState("");
  const [dashPhrase, setDashPhrase] = useState("");
  const resolver = useRef<((a: ActiveAccount | null) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const connectQorex = useCallback(async (network: NetworkId) => {
    setBusy(true);
    setError(null);
    setQorexMissing(false);
    try {
      const mod = await import("@/lib/signer/qorex");
      const s = await mod.connectQorex(network);
      setSigner(s);
      setViewer(null);
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
      setViewer(null);
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
    setViewer(null);
    setError(null);
  }, []);

  const settle = useCallback((account: ActiveAccount | null) => {
    resolver.current?.(account);
    resolver.current = null;
    setPicker(null);
    setPickerError(null);
    setDashOpen(false);
    setDashPhrase("");
  }, []);

  const pick = useCallback((network: NetworkId) => {
    resolver.current?.(null);
    setPickerError(null);
    setWallets(null);
    setPicker({ network });
    return new Promise<ActiveAccount | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Detect wallets each time the picker opens: extensions can be added or unlocked at any moment.
  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    dialog.current?.showModal();
    import("@/lib/wallets/detect")
      .then((m) => m.detectWallets())
      .then((w) => !cancelled && setWallets(w))
      .catch(() => !cancelled && setWallets([]));
    return () => {
      cancelled = true;
    };
  }, [picker]);

  const choose = async (wallet: DetectedWallet) => {
    if (!picker) return;
    setPickerError(null);
    setBusy(true);
    try {
      if (wallet.family === "qorex") {
        const mod = await import("@/lib/signer/qorex");
        const s = await mod.connectQorex(picker.network);
        setSigner(s);
        setViewer(null);
        settle({ address: s.address, network: s.network, label: s.label, canSign: true });
      } else {
        const mod = await import("@/lib/wallets/detect");
        const account = await mod.connectViewer(wallet, picker.network);
        setViewer(account);
        setSigner(null);
        settle({ address: account.address, network: account.network, label: wallet.name, canSign: false });
      }
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : `Could not connect ${wallet.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const connectDashboard = async () => {
    setPickerError(null);
    setBusy(true);
    try {
      const mod = await import("@/lib/signer/local");
      const s = await mod.connectDashboardWallet(dashPhrase, dashAddress, { rest: browserEndpoints("testnet").rest });
      setSigner(s);
      setViewer(null);
      setDashPhrase("");
      settle({ address: s.address, network: s.network, label: s.label, canSign: true });
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "That phrase could not be used.");
    } finally {
      setBusy(false);
    }
  };

  const active = useMemo<ActiveAccount | null>(
    () =>
      signer
        ? { address: signer.address, network: signer.network, label: signer.label, canSign: true }
        : viewer
          ? { address: viewer.address, network: viewer.network, label: viewer.wallet.name, canSign: false }
          : null,
    [signer, viewer],
  );

  const value = useMemo(
    () => ({ signer, viewer, active, busy, error, qorexMissing, connectQorex, connectLocal, pick, disconnect }),
    [signer, viewer, active, busy, error, qorexMissing, connectQorex, connectLocal, pick, disconnect],
  );

  const hasQorex = wallets?.some((w) => w.family === "qorex") ?? false;

  return (
    <WalletContext.Provider value={value}>
      {children}
      {picker && (
        <dialog ref={dialog} className="picker" aria-labelledby="picker-h" onClose={() => settle(null)}>
          <div className="row between">
            <h2 id="picker-h">Connect a wallet</h2>
            <button className="btn ghost small" onClick={() => dialog.current?.close()} aria-label="Close">
              Close
            </button>
          </div>
          <p className="muted">
            Wallets found in this browser. QoreX holds your post-quantum key, so it is the one that can open a window.
            The others can show your account.
          </p>

          {wallets === null ? (
            <p className="muted" role="status">
              <span className="spinner" />
              Looking for wallets…
            </p>
          ) : wallets.length === 0 ? (
            <div className="notice info">No wallet was found in this browser.</div>
          ) : (
            <ul className="wallet-list">
              {wallets.map((w) => (
                <li key={w.id}>
                  <button className="wallet-row" disabled={busy} onClick={() => void choose(w)}>
                    <span className="wallet-icon" aria-hidden="true">
                      {w.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.icon} alt="" width={28} height={28} />
                      ) : (
                        w.name.slice(0, 1)
                      )}
                    </span>
                    <span className="wallet-text">
                      <b>{w.name}</b>
                      <span>{w.role}</span>
                    </span>
                    <span className={`pill ${w.canSign ? "active" : ""}`}>{w.canSign ? "Signs" : "View only"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picker.network === "testnet" && wallets !== null && (
            <div className="stack">
              <button
                className="wallet-row"
                disabled={busy}
                aria-expanded={dashOpen}
                onClick={() => {
                  setDashOpen((v) => !v);
                  setPickerError(null);
                }}
              >
                <span className="wallet-icon" aria-hidden="true">
                  D
                </span>
                <span className="wallet-text">
                  <b>QoreChain Dashboard wallet</b>
                  <span>Testnet. Signs with the phrase you reveal on the Dashboard</span>
                </span>
                <span className="pill active">Signs</span>
              </button>
              {dashOpen && (
                <div className="card stack">
                  <p>
                    The Dashboard cannot be reached by other sites, so Fenestella signs with its recovery phrase,
                    inside this tab. On{" "}
                    <a href="https://dashboard.qorechain.io/wallet" target="_blank" rel="noreferrer">
                      the Dashboard&apos;s Wallet page
                    </a>{" "}
                    (Testnet), find <strong>Recovery phrase</strong> and press <strong>Reveal</strong> on your wallet.
                  </p>
                  <div className="field">
                    <label htmlFor="dash-addr">Your Dashboard address</label>
                    <input
                      id="dash-addr"
                      className="input mono"
                      value={dashAddress}
                      onChange={(e) => setDashAddress(e.target.value)}
                      placeholder="qor1…"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="hint">Fenestella refuses the phrase unless it opens exactly this address.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="dash-phrase">Recovery phrase</label>
                    <textarea
                      id="dash-phrase"
                      className="input"
                      rows={3}
                      value={dashPhrase}
                      onChange={(e) => setDashPhrase(e.target.value)}
                      placeholder="24 words"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="hint">
                      Kept in this tab&apos;s memory only: never stored, never sent. Gone when you reload. The same
                      address exists on mainnet, so never use a phrase that holds real QOR.
                    </span>
                  </div>
                  <div>
                    <button
                      className="btn accent small"
                      disabled={busy || !/^qor1[0-9a-z]{38,58}$/.test(dashAddress.trim()) || dashPhrase.trim().split(/\s+/).length < 12}
                      onClick={() => void connectDashboard()}
                    >
                      {busy ? "Checking…" : "Check and connect"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {pickerError && (
            <div className="notice err" role="alert">
              {pickerError}
            </div>
          )}

          {wallets !== null && !hasQorex && (
            <div className="stack">
              <span className="label">Get QoreX to sign</span>
              <div className="row">
                {QOREX_LINKS.map((l) => (
                  <a key={l.href} className="btn ghost small" href={l.href} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                ))}
              </div>
              <span className="faint">
                On a phone, open this site inside the QoreX app&apos;s browser. After installing, switch QoreX to{" "}
                {picker.network === "testnet" ? "Testnet" : "Mainnet"} and reload this page.
              </span>
            </div>
          )}
        </dialog>
      )}
    </WalletContext.Provider>
  );
}

/**
 * Connect controls inside a form. QoreX is the way to sign. The testnet key
 * option is for development only and is kept behind a disclosure.
 */
export function ConnectPanel({ network, onConnected }: { network: NetworkId; onConnected?: (a: ActiveAccount) => void }) {
  const w = useWallet();
  const [showLocal, setShowLocal] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  if (w.active) {
    return (
      <div className="stack">
        <div className="row between">
          <span className="muted">
            <span className={`dot ${w.active.canSign ? "good" : "warn"}`} />
            {w.active.label}: <span className="mono">{shortAddress(w.active.address)}</span>
            {w.active.network !== network && " (connected on the other network)"}
          </span>
          <button className="btn ghost small" onClick={w.disconnect}>
            Disconnect
          </button>
        </div>
        {!w.active.canSign && (
          <div className="notice info">
            {w.active.label} holds your classical key only, so it cannot open or close a window. Connect QoreX to sign.
            Once a window is open, {w.active.label} can send EVM transactions through it.
            <div style={{ marginTop: 10 }}>
              <button className="btn small" onClick={() => void w.pick(network).then((a) => a && onConnected?.(a))}>
                Choose another wallet
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn"
          disabled={w.busy}
          onClick={() => void w.pick(network).then((a) => a && onConnected?.(a))}
        >
          {w.busy ? "Connecting…" : "Connect wallet"}
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
                  onConnected?.({ address: s.address, network: s.network, label: s.label, canSign: true });
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
