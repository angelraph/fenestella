"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccount, type AccountAnswer } from "@/lib/client";
import { ConnectPanel, useWallet } from "./Wallet";

/**
 * The radar's one-click fix: read the connected account, say where it stands,
 * and offer the one action that seals it. Register the post-quantum key (QoreX
 * does it with the first send), or close an open window.
 */
export function SealMyAccount() {
  const wallet = useWallet();
  const signer = wallet.signer;
  const [answer, setAnswer] = useState<AccountAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; tx?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signer) return;
    setAnswer(await fetchAccount(signer.network, signer.address));
  }, [signer]);

  useEffect(() => {
    setAnswer(null);
    setDone(null);
    if (signer) load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [signer, load]);

  const act = async (kind: "register" | "close") => {
    if (!signer) return;
    setBusy(true);
    setError(null);
    try {
      let tx = "";
      if (kind === "register") {
        const local = signer as unknown as { registerPqcKey?: () => Promise<{ txHash: string }> };
        if (typeof local.registerPqcKey === "function") {
          tx = (await local.registerPqcKey()).txHash;
        } else {
          const { msg } = await import("@qorechain/sdk");
          tx = (await signer.signAndBroadcast([msg.bank.send({ fromAddress: signer.address, toAddress: signer.address, amount: [{ denom: "uqor", amount: "1" }] }) as never], "fenestella: seal my account")).txHash;
        }
        setDone({ text: "Your post-quantum key is registered. A stolen classical key can no longer take this account.", tx });
      } else {
        const { closeWindowMessage } = await import("@/lib/messages");
        tx = (await signer.signAndBroadcast([closeWindowMessage(signer.address)], "fenestella: seal my account")).txHash;
        setDone({ text: "The window is closed. A stolen classical key can no longer move anything on the EVM side.", tx });
      }
      await new Promise((r) => setTimeout(r, 2500));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!signer) {
    return (
      <div className="stack">
        <p>Connect a wallet that signs to check your own account and seal it in one step.</p>
        <ConnectPanel network="testnet" />
      </div>
    );
  }

  const level = answer?.exposure.level;
  return (
    <div className="stack">
      {!answer ? (
        <p className="muted" role="status">
          <span className="spinner" />
          Reading your account on {signer.network}…
        </p>
      ) : (
        <div className="exposure" data-level={level}>
          <p className="headline">{answer.exposure.headline}</p>
        </div>
      )}
      {level === "takeover" && (
        <div className="row">
          <button className="btn accent" disabled={busy} onClick={() => act("register")}>
            {busy ? "Signing…" : "Seal my account: register my post-quantum key"}
          </button>
          <span className="faint">{"registerPqcKey" in (signer as object) ? "Registers ML-DSA-87 with a proof of possession." : "QoreX registers the key with this first send (1 uqor to yourself)."}</span>
        </div>
      )}
      {(level === "open" || level === "scoped") && (
        <div className="row">
          <button className="btn accent" disabled={busy} onClick={() => act("close")}>
            {busy ? "Signing…" : "Seal my account: close the window"}
          </button>
          <a className="faint" href={`/account/${signer.address}?network=${signer.network}`}>or narrow it instead</a>
        </div>
      )}
      {level === "sealed" && !done && <p className="notice ok">Sealed. A stolen classical key moves nothing from this account.</p>}
      {done && (
        <p className="notice ok">
          {done.text}{" "}
          {done.tx && (
            <a className="mono" href={`/tx/${done.tx}`} target="_blank" rel="noreferrer">
              receipt
            </a>
          )}
        </p>
      )}
      {error && <p className="notice err">{error}</p>}
    </div>
  );
}
