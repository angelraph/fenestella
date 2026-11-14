"use client";

import { useMemo, useState } from "react";
import { validateWindowSpec, windowCliCommand, type WindowSpec } from "@fenestella/connect";
import { pollAccount, type AccountAnswer } from "@/lib/client";
import { blocksToDuration, plural, qorToUqor, uqorToQor } from "@/lib/format";
import { NETWORKS } from "@/lib/networks";
import { draftFromPreset, draftToSpec, PRESETS, type WindowDraft } from "@/lib/presets";
import type { AccountTruth } from "@/lib/truth";
import { ConnectPanel, useWallet } from "./Wallet";

/** A spec in plain words, the same sentence wherever a window is shown. */
export function describeSpec(spec: WindowSpec, blockSeconds: number): React.ReactNode {
  const targets = spec.allowedTargets ?? [];
  return (
    <>
      Up to <strong>{plural(spec.maxTxs, "EVM transaction")}</strong>, spending at most{" "}
      <strong>{uqorToQor(spec.maxValueUqor)} QOR</strong> in value and fees, for{" "}
      <strong>
        {spec.blocks.toLocaleString("en-US")} blocks (about {blocksToDuration(spec.blocks, blockSeconds)})
      </strong>
      ,{" "}
      {spec.nativeOnly ? (
        <strong>plain QOR transfers only</strong>
      ) : targets.length > 0 ? (
        <>
          only to <strong>{plural(targets.length, "named address", "named addresses")}</strong>
        </>
      ) : (
        <strong>to any address or contract</strong>
      )}
      .
    </>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "ok"; text: string; txHash?: string }
  | { kind: "err"; text: string };

export function WindowForm({ truth, onChanged }: { truth: AccountTruth; onChanged: (a: AccountAnswer) => void }) {
  const wallet = useWallet();
  const net = NETWORKS[truth.network];
  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
  const [draft, setDraft] = useState<WindowDraft>(() => draftFromPreset(PRESETS[0]));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const built = useMemo((): { spec: WindowSpec | null; errors: string[] } => {
    try {
      const spec = draftToSpec(draft, truth.blockSeconds, qorToUqor);
      const errors = validateWindowSpec(spec);
      if (draft.scope === "targets" && (spec.allowedTargets ?? []).length === 0) {
        errors.push("List at least one contract address, or choose another scope.");
      }
      return { spec, errors };
    } catch (err) {
      return { spec: null, errors: [err instanceof Error ? err.message : "Check the amount."] };
    }
  }, [draft, truth.blockSeconds]);

  const signer = wallet.signer;
  const isOwner = !!signer && signer.address === truth.address.cosmos && signer.network === truth.network;
  const blocked =
    !truth.pqc.registered
      ? "This account has no post-quantum key yet, so it cannot open a window. Register the key first: in QoreX the first send does it."
      : truth.keyType === "secp256k1"
        ? "This is a coin-118 account. The EVM lane does not accept its key, so a window would only cost its fee. Add an Ethereum account (coin 60) in QoreX."
        : null;
  const working = status.kind === "working";
  const live = truth.window?.live === true;

  const run = async (label: string, build: () => Promise<{ txHash: string }>, done: (a: AccountAnswer) => boolean) => {
    setStatus({ kind: "working", text: `${label}: approve it in ${signer?.label ?? "your wallet"}…` });
    try {
      const res = await build();
      setStatus({ kind: "working", text: "Signed and sent. Waiting for the chain…" });
      const { answer, settled } = await pollAccount(truth.network, truth.address.cosmos, done);
      onChanged(answer);
      setStatus(
        settled
          ? { kind: "ok", text: `${label}: done.`, txHash: res.txHash }
          : { kind: "err", text: `The transaction was sent (${res.txHash}) but the chain does not show the change yet. Refresh in a moment.` },
      );
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : "Something went wrong." });
    }
  };

  const open = async () => {
    if (!signer || !built.spec) return;
    const { openWindowMessage } = await import("@/lib/messages");
    const spec = built.spec;
    await run(
      "Open window",
      () => signer.signAndBroadcast([openWindowMessage(signer.address, spec)], "fenestella: open window"),
      (a) => a.truth.window?.live === true && a.truth.window.maxTxs === String(spec.maxTxs),
    );
  };

  const close = async () => {
    if (!signer) return;
    const { closeWindowMessage } = await import("@/lib/messages");
    await run(
      "Close window",
      () => signer.signAndBroadcast([closeWindowMessage(signer.address)], "fenestella: close window"),
      (a) => a.truth.window?.live !== true,
    );
  };

  return (
    <section className="card stack" aria-labelledby="window-h">
      <div className="row between">
        <h2 id="window-h">Open a fenestella</h2>
        {live && (
          <button className="btn danger small" disabled={!isOwner || working} onClick={close}>
            Close the open window now
          </button>
        )}
      </div>
      <p>
        An EVM window is the only thing a classical key can act through. Choose the narrowest one that does the job.
        Opening a new window replaces the current one.
      </p>

      <div className="presets" role="group" aria-label="Starting points">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="preset"
            aria-pressed={presetId === p.id}
            onClick={() => {
              setPresetId(p.id);
              setDraft((d) => draftFromPreset(p, d.targetsText));
            }}
          >
            <b>{p.title}</b>
            <span>{p.blurb}</span>
          </button>
        ))}
      </div>

      <div className="fields">
        <div className="field">
          <label htmlFor="w-min">Open for (minutes)</label>
          <input
            id="w-min"
            className="input"
            type="number"
            min={1}
            max={Math.floor((17_280 * truth.blockSeconds) / 60)}
            value={draft.minutes}
            onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="w-txs">Transactions</label>
          <input
            id="w-txs"
            className="input"
            type="number"
            min={1}
            max={1000}
            value={draft.maxTxs}
            onChange={(e) => setDraft({ ...draft, maxTxs: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="w-val">Spending cap (QOR)</label>
          <input
            id="w-val"
            className="input"
            inputMode="decimal"
            value={draft.maxValueQor}
            onChange={(e) => setDraft({ ...draft, maxValueQor: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="w-scope">Scope</label>
          <select
            id="w-scope"
            className="select"
            value={draft.scope}
            onChange={(e) => setDraft({ ...draft, scope: e.target.value as WindowDraft["scope"] })}
          >
            <option value="targets">Named contracts only</option>
            <option value="native">Plain QOR transfers only</option>
            <option value="any">Anything (widest)</option>
          </select>
        </div>
      </div>

      {draft.scope === "targets" && (
        <div className="field">
          <label htmlFor="w-targets">Allowed addresses (up to 16, one per line)</label>
          <textarea
            id="w-targets"
            className="input"
            rows={3}
            value={draft.targetsText}
            onChange={(e) => setDraft({ ...draft, targetsText: e.target.value })}
            placeholder="0x…"
            spellCheck={false}
          />
          <span className="hint">
            The cap counts native QOR only. If an address here is a token, the window does not limit token amounts.
          </span>
        </div>
      )}

      {built.spec && built.errors.length === 0 ? (
        <>
          <div className="summary">
            This window allows: {describeSpec(built.spec, truth.blockSeconds)} The cap covers each amount sent plus its
            maximum fee.
          </div>
          <details>
            <summary className="faint">Same thing from the command line</summary>
            <pre className="cli">{windowCliCommand(built.spec)} --chain-id {net.chainId}</pre>
          </details>
        </>
      ) : (
        <div className="notice err" role="alert">
          {built.errors.join(" ")}
        </div>
      )}

      {blocked ? (
        <div className="notice info">{blocked}</div>
      ) : !signer ? (
        <ConnectPanel network={truth.network} />
      ) : !isOwner ? (
        <div className="stack">
          <div className="notice info">
            The connected wallet is a different account or network. Only this account&apos;s own keys can open its
            window.
          </div>
          <ConnectPanel network={truth.network} />
        </div>
      ) : (
        <div className="row">
          <button className="btn accent" disabled={working || built.errors.length > 0 || !built.spec} onClick={open}>
            {live ? "Replace window" : "Open window"}
          </button>
          <span className="faint">Signed by {signer.label} with the hybrid ML-DSA-87 signature.</span>
        </div>
      )}

      {status.kind === "working" && (
        <div className="notice info" role="status">
          <span className="spinner" />
          {status.text}
        </div>
      )}
      {status.kind === "ok" && (
        <div className="notice ok" role="status">
          {status.text}{" "}
          {status.txHash && (
            <a href={`${net.explorer}/tx/${status.txHash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}
      {status.kind === "err" && (
        <div className="notice err" role="alert">
          {status.text}
        </div>
      )}
    </section>
  );
}
