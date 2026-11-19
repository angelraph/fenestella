"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Item {
  kind: "link" | "revoke" | "rules" | "window" | "autopay" | "order" | "paid" | "refused" | "stop";
  title: string;
  detail: string;
  tx: string;
  at: string;
  by: "you" | "agent";
}

const ICON: Record<Item["kind"], string> = {
  link: "⛓",
  revoke: "✂",
  rules: "≡",
  window: "◱",
  autopay: "↻",
  order: "✉",
  paid: "✓",
  refused: "✕",
  stop: "■",
};

const when = (iso: string) => new Date(iso).toUTCString().slice(5, 22) + " UTC";

/**
 * The agent's record for one account, read from the chain: what it paid, what
 * was refused, and every permission the owner gave or took back. Shown on the
 * account page and the agent page, with a receipt for each line.
 */
export function AgentHistory({ owner, compact = false }: { owner: string; compact?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agent/history?owner=${owner}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { items?: Item[]; error?: string }) => {
        if (cancelled) return;
        if (b.items) setItems(b.items);
        else setError(b.error ?? "The history could not be read.");
      })
      .catch(() => !cancelled && setError("The history could not be read."));
    return () => {
      cancelled = true;
    };
  }, [owner]);

  if (error) return <p className="faint">{error}</p>;
  if (!items) {
    return (
      <p className="muted" role="status">
        <span className="spinner" />
        Reading the agent&apos;s record from the chain…
      </p>
    );
  }
  if (items.length === 0) {
    return compact ? null : <p className="faint">No agent activity on this account yet.</p>;
  }
  const paid = items.filter((i) => i.kind === "paid").length;
  const refused = items.filter((i) => i.kind === "refused").length;
  const shown = all ? items : items.slice(0, 8);
  return (
    <div className="hist">
      <p className="hist-sum">
        <b>{paid}</b> {paid === 1 ? "payment" : "payments"} · <b>{refused}</b> refused · <b>{items.length - paid - refused}</b>{" "}
        {items.length - paid - refused === 1 ? "change" : "changes"} by the owner, newest first
      </p>
      <ol className="hist-list">
        {shown.map((i) => (
          <li key={i.tx + i.kind + i.title} className={`hist-item k-${i.kind}`}>
            <span className="hist-icon" aria-hidden="true">
              {ICON[i.kind]}
            </span>
            <div>
              <div className="hist-title">{i.title}</div>
              <div className="hist-detail">{i.detail}</div>
              <div className="hist-meta">
                {i.by === "you" ? "Signed by the owner" : "Signed by the agent, relayed"} · {when(i.at)} ·{" "}
                <Link className="mono" href={`/tx/${i.tx}`}>
                  receipt
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {items.length > 8 && (
        <button className="btn ghost small" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
