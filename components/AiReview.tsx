"use client";

import { useEffect, useState } from "react";

export interface Review {
  decision: "draft_mandate" | "hold" | "refuse";
  risk: "low" | "medium" | "high";
  matched_bill_id: string | null;
  extracted: { vendor: string; amount_qor: string; due: string; reference: string; pay_to: string };
  flags: { kind: string; detail: string }[];
  explanation: string;
  mandate_note: string;
  max_pay_qor: string;
}

export interface AiResult {
  review: Review;
  /** Corrections Fenestella's own rules made to the AI's answer. */
  guard?: string[];
  calls: { tool: string; summary: string }[];
  model: string;
}

const DECISION: Record<Review["decision"], string> = {
  draft_mandate: "Safe to pay: mandate drafted",
  hold: "Hold: check this first",
  refuse: "Refused: do not pay",
};

/**
 * The agent's AI reading an invoice for `owner`. Read-only: it never signs or
 * sends anything, so it also runs on the demo account for visitors without a
 * wallet.
 */
export function AiReview({
  owner,
  ownerEvm,
  ai,
  reloadKey,
  onUseDraft,
}: {
  owner: string;
  ownerEvm: string;
  ai: { ready: boolean; model: string } | null;
  /** Change it to reload the sample invoices (e.g. after a new bill). */
  reloadKey?: string | number;
  onUseDraft?: (review: Review) => void;
}) {
  const [invoice, setInvoice] = useState("");
  const [samples, setSamples] = useState<{ id: string; label: string; text: string }[]>([]);
  const [result, setResult] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [samplesState, setSamplesState] = useState<"loading" | "ready" | "failed">("loading");
  const [samplesTry, setSamplesTry] = useState(0);

  // The samples are built from the chain, and a cold server can take a while or
  // fail once: retry a few times before saying so, so the buttons always appear.
  useEffect(() => {
    let live = true;
    setSamplesState("loading");
    (async () => {
      for (let attempt = 0; attempt < 4 && live; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
        try {
          const r = await fetch(`/api/agent/analyze?ownerEvm=${ownerEvm}`, { cache: "no-store" });
          const b = (await r.json()) as { samples?: { id: string; label: string; text: string }[] };
          if (r.ok && b.samples?.length) {
            if (live) {
              setSamples(b.samples);
              setSamplesState("ready");
            }
            return;
          }
        } catch {
          // try again
        }
      }
      if (live) setSamplesState("failed");
    })();
    return () => {
      live = false;
    };
  }, [ownerEvm, reloadKey, samplesTry]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, invoice }),
      });
      const body = (await res.json()) as AiResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The AI could not review this.");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {samples.length === 0 && samplesState === "loading" && <p className="faint">Loading the sample invoices from the chain…</p>}
      {samples.length === 0 && samplesState === "failed" && (
        <div className="row">
          <span className="faint">The sample invoices could not be loaded just now.</span>
          <button className="btn ghost small" onClick={() => setSamplesTry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {samples.length > 0 && (
        <div className="row">
          <span className="faint">Try one:</span>
          {samples.map((x) => (
            <button
              key={x.id}
              className="btn ghost small"
              onClick={() => {
                setInvoice(x.text);
                setResult(null);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        id="ai-invoice"
        className="input"
        rows={7}
        value={invoice}
        onChange={(e) => setInvoice(e.target.value)}
        placeholder="Paste an invoice, an email or a payment request…"
        spellCheck={false}
      />
      <div className="row">
        <button className="btn accent" disabled={busy || invoice.trim().length < 10 || !ai?.ready} onClick={ask}>
          {busy ? "The AI is checking the chain…" : "Review with the agent's AI"}
        </button>
        {ai && !ai.ready && <span className="faint">The AI is not configured on this server yet.</span>}
      </div>
      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="ai-result stack" data-decision={result.review.decision}>
          <div className="row between">
            <strong className="ai-decision">{DECISION[result.review.decision]}</strong>
            <span className={`pill risk-${result.review.risk}`}>Risk: {result.review.risk}</span>
          </div>
          <p>{result.review.explanation}</p>
          {result.review.flags.length > 0 && (
            <ul className="list warn">
              {result.review.flags.map((f, i) => (
                <li key={i}>
                  <strong>{f.kind.replace(/_/g, " ")}:</strong> {f.detail}
                </li>
              ))}
            </ul>
          )}
          {result.guard && result.guard.length > 0 && (
            <div className="notice ai-guard">
              <strong>Fenestella&apos;s rules, applied after the AI:</strong>
              <ul className="list">
                {result.guard.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="facts ai-facts">
            <div className="fact">
              <div className="k">Vendor</div>
              <div className="v">{result.review.extracted.vendor || "?"}</div>
            </div>
            <div className="fact">
              <div className="k">Amount asked</div>
              <div className="v">{result.review.extracted.amount_qor || "?"} QOR</div>
            </div>
            <div className="fact">
              <div className="k">Matches bill</div>
              <div className="v">{result.review.matched_bill_id ? `#${result.review.matched_bill_id}` : "None"}</div>
            </div>
          </div>
          <details>
            <summary className="faint">
              How the AI checked ({result.calls.length} tool calls, {result.model})
            </summary>
            <ol className="ai-calls">
              {result.calls.map((c, i) => (
                <li key={i}>
                  <span className="mono">{c.tool}</span> · {c.summary}
                </li>
              ))}
            </ol>
          </details>
          {onUseDraft && result.review.decision === "draft_mandate" && result.review.matched_bill_id && (
            <div>
              <button className="btn accent small" onClick={() => onUseDraft(result.review)}>
                Use this draft for the mandate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
