"use client";

import { useState } from "react";
import { pollAccount, type AccountAnswer } from "@/lib/client";
import { qorToUqor, uqorToQor } from "@/lib/format";
import type { AccountTruth } from "@/lib/truth";
import { useWallet } from "./Wallet";

const CALL = /^0x[0-9a-fA-F]{40}(\/0x[0-9a-fA-F]{8})?$/;

/**
 * Edit the account's spending rule and revoke linked keys. Owner-signed.
 * `MsgUpdateSpendingRules` replaces all rules, so the editor sends the full
 * list back with the first enabled rule changed.
 */
export function RulesEditor({ truth, onChanged }: { truth: AccountTruth; onChanged: (a: AccountAnswer) => void }) {
  const w = useWallet();
  const signer = w.signer;
  const isOwner = !!signer && signer.address === truth.address.cosmos && signer.network === truth.network;
  const rules = truth.abstractAccount.rules;
  const first = rules.find((r) => r.enabled) ?? rules[0] ?? null;

  const [perTx, setPerTx] = useState(first ? uqorToQor(first.perTxLimit) : "1");
  const [daily, setDaily] = useState(first ? uqorToQor(first.dailyLimit) : "5");
  const [calls, setCalls] = useState((first?.allowedEvmCalls ?? []).join("\n"));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOwner) return null;

  const run = async (label: string, build: () => Promise<{ typeUrl: string; value: unknown }[]>, done: (a: AccountAnswer) => boolean) => {
    setBusy(label);
    setMsg(null);
    try {
      const messages = await build();
      const r = await signer!.signAndBroadcast(messages as never, `fenestella: ${label.toLowerCase()}`);
      const { answer } = await pollAccount(truth.network, truth.address.cosmos, done);
      onChanged(answer);
      setMsg({ ok: true, text: `${label}: done (${r.txHash.slice(0, 10)}…).` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    const list = calls.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
    const bad = list.find((c) => !CALL.test(c));
    if (bad) {
      setMsg({ ok: false, text: `Not a call entry: ${bad}. Use 0x<contract> or 0x<contract>/0x<selector>.` });
      return;
    }
    let p: bigint, d: bigint;
    try {
      p = qorToUqor(perTx);
      d = qorToUqor(daily);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (p === 0n && d === 0n) {
      setMsg({ ok: false, text: "Set a per-payment or a daily cap. A rule that limits nothing is refused for keys that move value." });
      return;
    }
    void run(
      "Save spending rule",
      async () => {
        const { msg } = await import("@qorechain/sdk");
        const others = rules.filter((r) => r !== first).map((r) => ({
          id: r.id,
          enabled: r.enabled,
          perTxLimit: r.perTxLimit,
          dailyLimit: r.dailyLimit,
          allowedDenoms: r.allowedDenoms,
          allowedEvmCalls: r.allowedEvmCalls,
          denomLimits: r.denomLimits,
        }));
        const updated = {
          id: first?.id ?? "fenestella",
          enabled: true,
          perTxLimit: p.toString(),
          dailyLimit: d.toString(),
          allowedDenoms: first?.allowedDenoms.length ? first.allowedDenoms : ["uqor"],
          allowedEvmCalls: list.map((c) => c.toLowerCase()),
          denomLimits: first?.denomLimits ?? [],
        };
        const messages = [];
        if (!truth.abstractAccount.account) {
          messages.push(msg.abstractaccount.createAbstractAccount({ owner: truth.address.cosmos, accountType: "session_based" }));
        }
        messages.push(msg.abstractaccount.updateSpendingRules({ owner: truth.address.cosmos, accountAddress: truth.address.cosmos, rules: [updated, ...others] }));
        return messages;
      },
      (a) => a.truth.abstractAccount.rules.some((r) => r.perTxLimit === p.toString() && r.dailyLimit === d.toString()),
    );
  };

  const revoke = (scheme: string, pubkeyHex: string) =>
    run(
      "Revoke key",
      async () => {
        const { revokeAuthenticatorMsg } = await import("@qorechain/sdk");
        const pubkey = Uint8Array.from(pubkeyHex.match(/../g)!.map((b) => parseInt(b, 16)));
        return [revokeAuthenticatorMsg({ owner: truth.address.cosmos, scheme: scheme as "secp256k1" | "ed25519", pubkey })];
      },
      (a) => a.truth.abstractAccount.authenticators.some((k) => k.pubkeyHex === pubkeyHex && k.revoked),
    );

  const active = truth.abstractAccount.authenticators.filter((k) => !k.revoked && BigInt(k.expiryUnix) > BigInt(Math.floor(Date.now() / 1000)));

  return (
    <div className="stack rules-editor">
      <h3>Edit the spending rule</h3>
      <p className="muted">
        Every linked key that moves value is bounded by this rule. The chain checks it on each payment. Leave the call
        list empty to forbid contract calls with data; list a contract, or a contract and function selector, to allow
        exactly those.
      </p>
      <div className="fields">
        <div className="field">
          <label htmlFor="r-pertx">Most per payment (QOR)</label>
          <input id="r-pertx" className="input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-daily">Most per day (QOR)</label>
          <input id="r-daily" className="input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="r-calls">Allowed contract calls (one per line)</label>
        <textarea id="r-calls" className="input" rows={3} value={calls} onChange={(e) => setCalls(e.target.value)} placeholder="0x<contract>/0x<selector>" spellCheck={false} />
        <span className="hint">Allowing a contract trusts every argument of the calls made to it, recipients included.</span>
      </div>
      <div className="row">
        <button className="btn accent small" disabled={!!busy} onClick={save}>
          {busy === "Save spending rule" ? "Signing…" : "Save rule"}
        </button>
      </div>
      {active.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Cut a key off at once</span>
          {active.map((k) => (
            <div className="row between" key={k.pubkeyHex}>
              <span className="mono faint">
                {k.label || k.scheme} · {k.pubkeyHex.slice(0, 10)}…
              </span>
              <button className="btn danger small" disabled={!!busy} onClick={() => void revoke(k.scheme, k.pubkeyHex)}>
                {busy === "Revoke key" ? "Revoking…" : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      )}
      {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </div>
  );
}
