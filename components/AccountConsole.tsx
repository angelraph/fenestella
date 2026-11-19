"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchAccount, type AccountAnswer } from "@/lib/client";
import type { ExposureLevel } from "@/lib/exposure";
import { blocksToDuration, plural, unixToDate, uqorToQor } from "@/lib/format";
import { NETWORKS, type NetworkId } from "@/lib/networks";
import type { AccountTruth, TruthSection } from "@/lib/truth";
import { AgentHistory } from "./AgentHistory";
import { Aperture } from "./Aperture";
import { RulesEditor } from "./RulesEditor";
import { WindowForm } from "./WindowForm";

const LEVEL_NAME: Record<ExposureLevel, string> = {
  sealed: "Sealed",
  scoped: "Scoped opening",
  open: "Wide open",
  takeover: "Can be taken over",
  unknown: "Not known",
};

function Fact({ k, v, s, dot }: { k: string; v: React.ReactNode; s?: React.ReactNode; dot?: "good" | "warn" | "bad" | "unk" }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v">
        {dot && <span className={`dot ${dot}`} />}
        {v}
      </div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function Facts({ t }: { t: AccountTruth }) {
  const unk = (s: TruthSection) => t.unknown.includes(s);
  const w = t.window;
  const keyType =
    t.keyType === "eth_secp256k1"
      ? { v: "Ethereum-style (coin 60)", s: "Can use the EVM lane", dot: "good" as const }
      : t.keyType === "secp256k1"
        ? { v: "Cosmos-style (coin 118)", s: "Cannot use the EVM lane", dot: "warn" as const }
        : t.keyType === "none"
          ? { v: "Not on chain yet", s: t.exists ? "Has never signed" : "Account not seen on chain", dot: "unk" as const }
          : { v: "Other", s: "", dot: "unk" as const };

  return (
    <div className="facts">
      <Fact
        k="Post-quantum key"
        dot={unk("pqc") ? "unk" : t.pqc.registered ? "good" : "bad"}
        v={unk("pqc") ? "Could not be read" : t.pqc.registered ? "ML-DSA-87 registered" : "Not registered"}
        s={
          t.pqc.registered
            ? t.pqc.possessionProven === true
              ? "Possession proven"
              : t.pqc.possessionProven === false
                ? "No proof of possession"
                : "Proof status not reported"
            : !unk("pqc") && "The classical key can still register one"
        }
      />
      <Fact k="Key type" dot={unk("auth") ? "unk" : keyType.dot} v={unk("auth") ? "Could not be read" : keyType.v} s={keyType.s} />
      <Fact
        k="EVM window"
        dot={unk("window") ? "unk" : w?.live ? "warn" : "good"}
        v={unk("window") ? "Could not be read" : w?.live ? "Open" : w ? "Closed" : "None"}
        s={
          w?.live
            ? `${plural(BigInt(w.remainingTxs), "tx", "txs")} · ${uqorToQor(w.remainingValue)} QOR · ${blocksToDuration(BigInt(w.remainingBlocks), t.blockSeconds)} left`
            : w
              ? "Last one expired or was used up"
              : !unk("window") && "Never opened"
        }
      />
      <Fact
        k="Window scope"
        v={!w?.live ? "Nothing to scope" : w.nativeOnly ? "Plain transfers only" : w.allowedTargets.length > 0 ? plural(w.allowedTargets.length, "named address", "named addresses") : "Any address"}
        s={w?.live && w.allowedTargets.length > 0 && <span className="mono">{w.allowedTargets.join(" ")}</span>}
      />
      <Fact
        k="Encryption key"
        dot={unk("kem") ? "unk" : t.kem.found ? "good" : undefined}
        v={unk("kem") ? "Could not be read" : t.kem.found ? "ML-KEM-1024 published" : "None published"}
        s={!t.kem.found && !unk("kem") && "Nobody can seal data to this account yet"}
      />
      <Fact
        k="Balance"
        v={unk("balances") ? "Could not be read" : `${uqorToQor(t.balanceUqor)} QOR`}
        s={t.tokens.length > 0 && `plus ${plural(t.tokens.length, "token")}`}
      />
    </div>
  );
}

function LinkedKeys({ answer, onChanged }: { answer: AccountAnswer; onChanged: (a: AccountAnswer) => void }) {
  const { truth: t, exposure } = answer;
  const aa = t.abstractAccount;
  const testnetOnly = <span className="pill testnet">Testnet only</span>;

  if (t.unknown.includes("abstractAccount")) {
    return (
      <section className="card stack">
        <div className="row between">
          <h2>Linked keys and spending rules</h2>
          {testnetOnly}
        </div>
        <p>These could not be read from the chain just now.</p>
      </section>
    );
  }
  return (
    <section className="card stack" aria-labelledby="keys-h">
      <div className="row between">
        <h2 id="keys-h">Linked keys and spending rules</h2>
        {testnetOnly}
      </div>
      {!aa.moduleEnabled ? (
        <p>
          Abstract accounts are switched off on {NETWORKS[t.network].label} by governance, so no key other than the
          account&apos;s own can act for it here.
        </p>
      ) : !aa.account ? (
        <p>
          No abstract account exists for this address, so no other key can act for it. Linked keys let an agent or a
          second wallet act under a spending rule, without ever holding the root keys.
        </p>
      ) : (
        <>
          <p>
            A <span className="mono">{aa.account.type}</span> account. {plural(aa.rules.length, "account-wide rule")},{" "}
            {plural(exposure.linkedKeys.filter((k) => k.state === "active").length, "active key")} of{" "}
            {exposure.linkedKeys.length}.
          </p>
          {aa.rules.map((r) => (
            <div className="summary" key={r.id}>
              Rule <strong>{r.id}</strong>
              {r.enabled ? "" : " (disabled: it limits nothing)"}:{" "}
              {uqorToQor(r.perTxLimit)} QOR per transaction, {uqorToQor(r.dailyLimit)} QOR per day
              {r.allowedDenoms.length > 0 && <>, denoms {r.allowedDenoms.join(", ")}</>}
              {r.allowedEvmCalls.length > 0 ? (
                <>
                  , EVM calls limited to <span className="mono">{r.allowedEvmCalls.join(" ")}</span>
                </>
              ) : (
                ", any EVM call"
              )}
              .
            </div>
          ))}
          <div>
            {exposure.linkedKeys.map((k, i) => {
              const a = aa.authenticators[i];
              return (
                <div className="keyrow" key={`${k.scheme}:${k.pubkeyHex}`}>
                  <div className="row">
                    <span className={`pill ${k.state === "active" ? "active" : ""}`}>{k.state}</span>
                    <strong>{k.label || "Unnamed key"}</strong>
                    <span className="faint mono">
                      {k.scheme} {k.pubkeyHex.slice(0, 10)}…{k.pubkeyHex.slice(-6)}
                    </span>
                  </div>
                  <span className="muted">{k.summary}</span>
                  {a && k.state === "active" && <span className="faint">Expires {unixToDate(a.expiryUnix)}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {aa.moduleEnabled && <RulesEditor truth={t} onChanged={onChanged} />}
    </section>
  );
}

export function AccountConsole({ address, network }: { address: string; network: NetworkId }) {
  const router = useRouter();
  const [answer, setAnswer] = useState<AccountAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnswer(await fetchAccount(network, address));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The account could not be read.");
    } finally {
      setLoading(false);
    }
  }, [address, network]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="row between">
      <div className="seg" role="group" aria-label="Network">
        {(["testnet", "mainnet"] as const).map((n) => (
          <button key={n} aria-pressed={network === n} onClick={() => router.push(`/account/${address}?network=${n}`)}>
            {NETWORKS[n].label}
          </button>
        ))}
      </div>
      <button className="btn ghost small" onClick={load} disabled={loading}>
        {loading ? "Reading…" : "Read again"}
      </button>
    </div>
  );

  if (error) {
    return (
      <div className="console">
        {header}
        <div className="notice err" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="console">
        {header}
        <p className="muted" role="status">
          <span className="spinner" />
          Reading the account from {NETWORKS[network].chainId}…
        </p>
      </div>
    );
  }

  const { truth: t, exposure: x } = answer;
  return (
    <div className="console">
      {header}
      <div className="idline">
        <span className="addr">{t.address.cosmos}</span>
        <span className="addr">{t.address.evm}</span>
      </div>

      <section className="exposure" data-level={x.level} aria-labelledby="exp-q">
        <Aperture level={x.level} />
        <div>
          <div className="question" id="exp-q">
            If this account&apos;s classical key leaked right now, an attacker could:
          </div>
          <p className="headline">{x.headline}</p>
          <span className="level-tag">{LEVEL_NAME[x.level]}</span>
        </div>
      </section>

      <Facts t={t} />

      <div className="cols">
        {x.can.length > 0 && (
          <section className="card stack">
            <h3>What the classical key alone can do</h3>
            <ul className="list can">
              {x.can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        )}
        {x.cannot.length > 0 && (
          <section className="card stack">
            <h3>What it cannot do</h3>
            <ul className="list cannot">
              {x.cannot.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        )}
        {(x.warnings.length > 0 || x.advice.length > 0) && (
          <section className="card stack">
            <h3>Worth doing</h3>
            <ul className="list warn">
              {x.warnings.map((c) => (
                <li key={c}>{c}</li>
              ))}
              {x.advice.map((a) => (
                <li key={a.text}>{a.text}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <WindowForm truth={t} onChanged={setAnswer} />
      <LinkedKeys answer={answer} onChanged={setAnswer} />

      {t.network === "testnet" && t.abstractAccount.authenticators.length > 0 && (
        <section className="card stack" aria-labelledby="hist-h">
          <h2 id="hist-h" style={{ margin: 0 }}>
            The agent&apos;s record on this account
          </h2>
          <p className="faint">
            Every payment, every refused attempt and every permission given or taken back, read from the chain.
          </p>
          <AgentHistory owner={t.address.cosmos} />
        </section>
      )}

      <p className="faint">
        Read from {t.chainId} at block {Number(t.height).toLocaleString("en-US")} ({t.readAt.replace("T", " ").slice(0, 19)} UTC).
        {t.unknown.length > 0 && ` Could not read: ${t.unknown.join(", ")}.`}
      </p>
    </div>
  );
}
