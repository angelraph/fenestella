"use client";

import { useEffect, useState } from "react";

type Layer = "chain" | "vault" | "contract" | "seal" | "signature" | "ai";

interface Attack {
  id: string;
  title: string;
  attacker: string;
  tries: string;
  expected: Layer;
  onChain: boolean;
}

interface Result {
  id: string;
  outcome: "refused" | "breach" | "error";
  stoppedBy: Layer | null;
  detail: string;
  tx?: string;
  ms: number;
}

const LAYER: Record<Layer, string> = {
  chain: "The chain",
  vault: "The vault",
  contract: "A contract",
  seal: "The seal (ML-KEM-1024)",
  signature: "A post-quantum signature check",
  ai: "The agent's AI",
};

/** Every attack runs live against testnet; nothing here is simulated in the page. */
export function AttackLab() {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [owner, setOwner] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);

  useEffect(() => {
    fetch("/api/lab", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { attacks: Attack[]; owner: string }) => {
        setAttacks(b.attacks);
        setOwner(b.owner);
      })
      .catch(() => undefined);
  }, []);

  const run = async (id: string) => {
    setRunning((s) => new Set(s).add(id));
    try {
      const res = await fetch("/api/lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const body = (await res.json()) as Result & { error?: string };
      setResults((r) => ({ ...r, [id]: res.ok ? body : { id, outcome: "error", stoppedBy: null, detail: body.error ?? "The lab did not answer.", ms: 0 } }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { id, outcome: "error", stoppedBy: null, detail: e instanceof Error ? e.message : String(e), ms: 0 } }));
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const runAll = async () => {
    setAll(true);
    for (const a of attacks) await run(a.id);
    setAll(false);
  };

  const done = Object.values(results);
  const refused = done.filter((r) => r.outcome === "refused").length;
  const breaches = done.filter((r) => r.outcome === "breach").length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card lab-score">
        <div>
          <div className="lab-big">
            {refused}
            <span>/{attacks.length || 13}</span>
          </div>
          <div className="faint">attacks refused this session</div>
        </div>
        <div>
          <div className={`lab-big ${breaches ? "bad" : ""}`}>{breaches}</div>
          <div className="faint">got through</div>
        </div>
        <div className="lab-actions">
          <button className="btn accent" disabled={all || attacks.length === 0} onClick={runAll}>
            {all ? "Running every attack…" : "Run every attack"}
          </button>
          <span className="faint">
            Victims are Fenestella&apos;s own test accounts, including <a href={`/account/${owner}?network=testnet`}>the lab owner</a>. About two minutes in all.
          </span>
        </div>
      </section>

      <div className="lab-grid">
        {attacks.map((a, i) => {
          const r = results[a.id];
          const busy = running.has(a.id);
          return (
            <article key={a.id} className="card lab-card" data-outcome={r?.outcome ?? (busy ? "running" : "idle")}>
              <div className="row between">
                <span className="lab-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="pill">{a.onChain ? "on chain" : "checked live"}</span>
              </div>
              <h3>{a.title}</h3>
              <p>
                <strong>The attacker has:</strong> {a.attacker}
              </p>
              <p>
                <strong>They try:</strong> {a.tries}
              </p>
              {r && (
                <div className="lab-result">
                  <div className="lab-verdict">
                    {r.outcome === "refused" ? `Stopped by ${LAYER[r.stoppedBy!]}` : r.outcome === "breach" ? "GOT THROUGH" : "Could not run"}
                    <span className="faint"> · {(r.ms / 1000).toFixed(1)}s</span>
                  </div>
                  <p>{r.detail}</p>
                  {r.tx && (
                    <a className="mono" href={`/tx/${r.tx}`} target="_blank" rel="noreferrer">
                      receipt {r.tx.slice(0, 10)}…
                    </a>
                  )}
                </div>
              )}
              <div>
                <button className="btn ghost small" disabled={busy || all} onClick={() => run(a.id)}>
                  {busy ? "Attacking…" : r ? "Run again" : "Run this attack"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
