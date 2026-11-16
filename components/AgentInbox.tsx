"use client";

import { useCallback, useEffect, useState } from "react";
import { shortAddress, uqorToQor } from "@/lib/format";
import { NETWORKS } from "@/lib/networks";
import type { Signer } from "@/lib/signer/types";

type SealKeys = { mlkemPublicKey: Uint8Array; x25519PublicKey?: Uint8Array };
type KeyedSigner = Signer & { sealKeys(): SealKeys };

interface Opened {
  tx: string;
  ok: boolean;
  sealedToYou: boolean;
  signedByAgent: boolean;
  report?: {
    billId: string;
    payee: string;
    payeeName: string | null;
    amountUqor: string;
    tx: string;
    basis: { kind: string; tx: string };
    ai: { model: string; reason: string };
    at: string;
  };
  problem?: string;
}

const net = NETWORKS.testnet;
const fromHex = (h: string) => Uint8Array.from((h.startsWith("0x") ? h.slice(2) : h).match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * The owner's half of two-way messaging: publish an encryption key, then read
 * the agent's reports. Each one is opened and its signature checked here, in
 * this tab, against the agent's post-quantum key as the chain stores it.
 */
export function AgentInbox({ signer, ownerEvm, kemPublished, onChange }: { signer: Signer; ownerEvm: string; kemPublished: boolean; onChange: () => void }) {
  const keyed = "sealKeys" in signer ? (signer as KeyedSigner) : null;
  const [items, setItems] = useState<Opened[] | null>(null);
  const [agent, setAgent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kemTx, setKemTx] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent/reports?ownerEvm=${ownerEvm}`, { cache: "no-store" });
    const body = (await res.json()) as { error?: string; purpose: string; agent: { address: string; pqPublicKey: string | null }; reports: { tx: string; envelope: string }[] };
    if (!res.ok) throw new Error(body.error ?? "Reports are unavailable.");
    setAgent(body.agent.address);
    if (!keyed) {
      setItems(body.reports.map((r) => ({ tx: r.tx, ok: false, sealedToYou: true, signedByAgent: false, problem: "Sealed to your encryption key. Open it with the wallet that published that key." })));
      return;
    }
    const [{ open }, { verifyMessage }] = await Promise.all([import("@qorechain/qoreseal"), import("@qorechain/qoresign")]);
    const keys = keyed.sealKeys();
    const opened = body.reports.map((r): Opened => {
      let text: string;
      try {
        text = new TextDecoder().decode(open({ chainId: net.chainId, purpose: body.purpose, envelope: fromHex(r.envelope), keys: keys as never }));
      } catch {
        return { tx: r.tx, ok: false, sealedToYou: false, signedByAgent: false, problem: "Sealed to a different encryption key than this browser holds." };
      }
      try {
        const inner = JSON.parse(text) as { report: string; signer: string; signature: unknown };
        let signed = false;
        if (inner.signer === body.agent.address && body.agent.pqPublicKey) {
          try {
            verifyMessage({ chainId: net.chainId, signer: inner.signer, data: inner.report, signature: inner.signature as never, pqPublicKey: fromB64(body.agent.pqPublicKey) });
            signed = true;
          } catch {
            signed = false;
          }
        }
        return { tx: r.tx, ok: signed, sealedToYou: true, signedByAgent: signed, report: JSON.parse(inner.report), problem: signed ? undefined : "The signature does not verify against the agent's key on chain." };
      } catch {
        return { tx: r.tx, ok: false, sealedToYou: true, signedByAgent: false, problem: "The report could not be read." };
      }
    });
    setItems(opened);
  }, [ownerEvm, keyed]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const publishKey = async () => {
    if (!keyed) return;
    setBusy(true);
    setError(null);
    try {
      const { msg, KEM_ALGORITHM_ML_KEM_1024 } = await import("@qorechain/sdk");
      const r = await signer.signAndBroadcast(
        [msg.pqc.registerKemKey({ sender: signer.address, algorithmId: KEM_ALGORITHM_ML_KEM_1024, publicKey: keyed.sealKeys().mlkemPublicKey }) as never],
        "fenestella: publish my encryption key",
      );
      setKemTx(r.txHash);
      await new Promise((res) => setTimeout(res, 2500));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {!kemPublished && (
        <div className="notice info">
          The agent seals reports to the encryption key you publish on chain (ML-KEM-1024). You have not published one yet.
          <div style={{ marginTop: 10 }}>
            {keyed ? (
              <button className="btn accent small" disabled={busy} onClick={publishKey}>
                {busy ? "Signing…" : "Publish my encryption key"}
              </button>
            ) : (
              <span className="faint">Publishing the key from this tab needs the QoreChain Dashboard wallet (testnet).</span>
            )}
          </div>
        </div>
      )}
      {kemTx && (
        <p className="notice ok">
          Published. <a className="mono" href={`/tx/${kemTx}`} target="_blank" rel="noreferrer">receipt</a>
        </p>
      )}
      {items && items.length === 0 && <p className="faint">No reports yet. The agent sends one after every payment it makes.</p>}
      {items && items.length > 0 && (
        <ul className="inbox">
          {items.map((it) => (
            <li key={it.tx} data-ok={it.ok}>
              {it.report ? (
                <>
                  <div className="row between">
                    <strong>
                      Paid bill #{it.report.billId}: {uqorToQor(it.report.amountUqor)} QOR to {it.report.payeeName ?? shortAddress(it.report.payee)}
                    </strong>
                    <span className="faint">{it.report.at.replace("T", " ").slice(0, 16)} UTC</span>
                  </div>
                  <p>
                    On your {it.report.basis.kind === "autopay" ? "autopay permission" : "sealed mandate"}. The AI ({it.report.ai.model}): {it.report.ai.reason}
                  </p>
                  <div className="row">
                    <span className="pill active">Sealed to you · ML-KEM-1024</span>
                    <span className={`pill ${it.signedByAgent ? "active" : "risk-high"}`}>{it.signedByAgent ? "Signed by the agent · ML-DSA-87, checked against the chain" : "Signature does not verify"}</span>
                    <a className="mono faint" href={`/tx/${it.report.tx}`} target="_blank" rel="noreferrer">payment</a>
                    <a className="mono faint" href={`/tx/${it.tx}`} target="_blank" rel="noreferrer">report</a>
                  </div>
                </>
              ) : (
                <p className="faint">
                  {it.problem}{" "}
                  <a className="mono" href={`/tx/${it.tx}`} target="_blank" rel="noreferrer">report</a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {agent && <p className="faint">The agent&apos;s on-chain identity: <a className="mono" href={`/account/${agent}?network=testnet`}>{shortAddress(agent)}</a>. Its post-quantum key is registered there.</p>}
      {error && <p className="notice err">{error}</p>}
    </div>
  );
}
