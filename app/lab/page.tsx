import Link from "next/link";
import { AttackLab } from "@/components/AttackLab";
import stats from "@/lib/generated/stats.json";
import { loadAttempts } from "@/lib/site-data";

export const metadata = { title: "Attack lab · Fenestella" };
export const revalidate = 120;

const when = (iso: string) => new Date(iso).toUTCString().slice(5, 22) + " UTC";

export default async function LabPage() {
  const attempts = await loadAttempts(30);
  const byVault = attempts.filter((a) => a.by === "the vault").length;
  const byChain = attempts.filter((a) => a.by === "the chain").length;
  const through = attempts.length - byVault - byChain;
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Attack lab · live on testnet</span>
        <h1 style={{ maxWidth: "17ch" }}>
          Try to rob it. <span className="hl">Watch what stops you.</span>
        </h1>
        <p className="lede">
          {stats.attacks} real attacks: a stolen classical key, a stolen agent key, forged post-quantum signatures,
          tampered sealed mandates, phishing and prompt injection against the AI. Each one runs now, against real
          accounts, and tells you which layer refused it, with a receipt when a transaction reached the chain.
        </p>
      </section>
      <AttackLab />

      <section className="section log" aria-labelledby="log-h" id="log">
        <div className="section-head">
          <span className="eyebrow">Published, failures and all</span>
          <h2 id="log-h">Every attempt, on the record</h2>
          <p>
            Each time anyone, anywhere, runs a stolen-agent-key attack, the transaction lands on testnet with the
            chain&apos;s own reason for refusing it. Here are the newest {attempts.length}: {byChain} stopped by the
            chain, {byVault} by the vault, {through === 0 ? "none got through" : `${through} got through`}.
          </p>
        </div>
        {attempts.length === 0 ? (
          <p className="notice info">The chain did not answer just now. Reload in a minute.</p>
        ) : (
          <ol className="log-list">
            {attempts.map((a) => (
              <li key={a.tx} className="log-item">
                <span className={`log-by ${a.by === "the vault" ? "vault" : a.by === "the chain" ? "chain" : "through"}`}>
                  {a.by === "nobody" ? "Got through" : `Stopped by ${a.by}`}
                </span>
                <div className="log-tried">{a.tried}</div>
                <div className="log-reason mono">{a.reason}</div>
                <div className="log-meta">
                  {when(a.at)} ·{" "}
                  <Link className="mono" href={`/tx/${a.tx}`}>
                    receipt {a.tx.slice(0, 10)}…
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="faint log-foot">
          The other attacks never reach a block, so they leave nothing on chain: the classical key is refused before a
          transaction is accepted, forged signatures and a replayed bill are rejected when the contract call is
          simulated, a tampered mandate fails to open, and the AI answers in the page. Their full results from our own run are published in{" "}
          <a href="https://github.com/angelraph/fenestella/blob/main/docs/proof/attack-lab-2026-11-16.json">
            docs/proof/attack-lab-2026-11-16.json
          </a>
          .
        </p>
      </section>
    </>
  );
}
