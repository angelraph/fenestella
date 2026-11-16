"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAccount, type AccountAnswer } from "@/lib/client";
import { qorToUqor, shortAddress, unixToDate, uqorToQor } from "@/lib/format";
import { NETWORKS } from "@/lib/networks";
import type { Signer } from "@/lib/signer/types";
import { ConnectPanel, useWallet } from "./Wallet";

interface Bill {
  id: string;
  payee: string;
  payer: string;
  amountUqor: string;
  paid: boolean;
}

interface Info {
  agent: string;
  relayer: string;
  vendor: string;
  vendorEvm: string;
  bills: string;
  chainId: string;
  sealRecipient: { mlkemPublicKey: string; x25519PublicKey: string };
  linkProof?: { pubkey: string; possessionProof: string };
  ownerBills: Bill[];
  ai?: { ready: boolean; model: string };
  error?: string;
}

interface Review {
  decision: "draft_mandate" | "hold" | "refuse";
  risk: "low" | "medium" | "high";
  matched_bill_id: string | null;
  extracted: { vendor: string; amount_qor: string; due: string; reference: string; pay_to: string };
  flags: { kind: string; detail: string }[];
  explanation: string;
  mandate_note: string;
  max_pay_qor: string;
}

interface AiResult {
  review: Review;
  calls: { tool: string; summary: string }[];
  model: string;
}

const DECISION: Record<Review["decision"], string> = {
  draft_mandate: "Safe to pay: mandate drafted",
  hold: "Hold: check before paying",
  refuse: "Refused: do not pay",
};

interface Step {
  ok: boolean;
  text: string;
  tx?: string;
}

const net = NETWORKS.testnet;
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} data-ok={s.ok}>
          <span>{s.text}</span>
          {s.tx && (
            <a href={`/tx/${s.tx}`} target="_blank" rel="noreferrer" className="mono">
              {s.tx.slice(0, 10)}…
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

type Busy = null | "link" | "revoke" | "bill" | "mandate" | "rogue" | "ai";

export function AgentConsole() {
  const wallet = useWallet();
  const signer: Signer | null = wallet.signer && wallet.signer.network === "testnet" ? wallet.signer : null;
  const [info, setInfo] = useState<Info | null>(null);
  const [account, setAccount] = useState<AccountAnswer | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const [perTx, setPerTx] = useState("1");
  const [daily, setDaily] = useState("3");
  const [days, setDays] = useState(14);

  const [billId, setBillId] = useState("");
  const [maxQor, setMaxQor] = useState("");
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState("Pay the hosting invoice for this month.");
  const [invoice, setInvoice] = useState("");
  const [samples, setSamples] = useState<{ id: string; label: string; text: string }[]>([]);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [mandateSteps, setMandateSteps] = useState<Step[] | null>(null);
  const [rogueSteps, setRogueSteps] = useState<Step[] | null>(null);
  const [linkTx, setLinkTx] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signer) return;
    const a = await fetchAccount("testnet", signer.address);
    setAccount(a);
    const res = await fetch(`/api/agent?owner=${signer.address}&ownerEvm=${a.truth.address.evm}`, { cache: "no-store" });
    const body = (await res.json()) as Info;
    if (!res.ok) throw new Error(body.error ?? "The agent is unavailable.");
    setInfo(body);
  }, [signer]);

  useEffect(() => {
    setInfo(null);
    setAccount(null);
    if (signer) load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [signer, load]);

  const agentKey = useMemo(() => {
    if (!info || !account) return null;
    const hex = info.agent.slice(2).toLowerCase();
    return account.truth.abstractAccount.authenticators.find((a) => a.pubkeyHex.toLowerCase() === hex) ?? null;
  }, [info, account]);
  const linked = !!agentKey && !agentKey.revoked && BigInt(agentKey.expiryUnix) > BigInt(Math.floor(Date.now() / 1000));
  const rule = account?.truth.abstractAccount.rules.find((r) => r.enabled) ?? null;
  const unpaid = info?.ownerBills.filter((b) => !b.paid) ?? [];
  const selected = unpaid.find((b) => b.id === billId) ?? unpaid[0] ?? null;

  useEffect(() => {
    if (selected) {
      setBillId(selected.id);
      setMaxQor((q) => q || uqorToQor(selected.amountUqor));
    }
  }, [selected]);

  const guard = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const link = () =>
    guard("link", async () => {
      if (!signer || !info?.linkProof || !account) throw new Error("Connect a wallet that signs first.");
      const leash = await import("@/lib/agent/leash");
      const msgs = [
        ...(account.truth.abstractAccount.account ? [] : [leash.createAbstractAccountMessage(signer.address)]),
        ...leash.linkAgentMessagesFromProof({
          owner: signer.address,
          chainId: net.chainId,
          proof: { pubkey: fromHex(info.linkProof.pubkey), possessionProof: fromHex(info.linkProof.possessionProof) },
          terms: {
            bills: info.bills,
            perTxUqor: qorToUqor(perTx),
            dailyUqor: qorToUqor(daily),
            expiryUnix: Math.floor(Date.now() / 1000) + days * 86400,
          },
        }),
      ];
      const r = await signer.signAndBroadcast(msgs, "fenestella: put the bill payer on a leash");
      setLinkTx(r.txHash);
      await new Promise((res) => setTimeout(res, 2500));
      await load();
    });

  const revoke = () =>
    guard("revoke", async () => {
      if (!signer || !info) return;
      const { revokeAgentMessage } = await import("@/lib/agent/leash");
      await signer.signAndBroadcast([revokeAgentMessage(signer.address, info.agent)], "fenestella: revoke the bill payer");
      await new Promise((res) => setTimeout(res, 2500));
      await load();
    });

  const askBill = () =>
    guard("bill", async () => {
      if (!account) return;
      const res = await fetch("/api/agent/bill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerEvm: account.truth.address.evm, amountUqor: "400000" }),
      });
      const body = (await res.json()) as { billId?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The vendor could not post a bill.");
      setBillId(body.billId ?? "");
      setMaxQor("");
      await load();
    });

  const sendMandate = () =>
    guard("mandate", async () => {
      if (!signer || !info || !selected) throw new Error("Pick a bill first.");
      setMandateSteps(null);
      const mandate = await import("@/lib/agent/mandate");
      const m = {
        v: 1 as const,
        kind: "pay-bill" as const,
        chainId: net.chainId,
        owner: signer.address,
        bills: info.bills,
        billId: selected.id,
        payee: selected.payee,
        maxUqor: qorToUqor(maxQor).toString(),
        notAfter: Math.floor(Date.now() / 1000) + hours * 3600,
        note: note.slice(0, 280),
      };
      const recipients: { mlkemPublicKey: Uint8Array; x25519PublicKey: Uint8Array }[] = [{ mlkemPublicKey: fromB64(info.sealRecipient.mlkemPublicKey), x25519PublicKey: fromB64(info.sealRecipient.x25519PublicKey) }];
      const own = "sealKeys" in signer ? (signer as unknown as { sealKeys(): { mlkemPublicKey: Uint8Array; x25519PublicKey: Uint8Array } }).sealKeys() : null;
      if (own) recipients.push({ mlkemPublicKey: own.mlkemPublicKey, x25519PublicKey: own.x25519PublicKey });
      const envelope = mandate.sealMandate(m, recipients);
      const steps: Step[] = [
        { ok: true, text: `Sealed in this browser with ML-KEM-1024 to the agent${own ? " and to you" : ""}. ${envelope.length.toLocaleString("en-US")} characters; the bill terms are bound to the seal.` },
      ];
      setMandateSteps([...steps]);
      const anchor = await signer.signAndBroadcast([mandate.anchorMessage(signer.address)], mandate.anchorMemo(envelope));
      steps.push({ ok: true, text: "You signed its fingerprint (SHA3-256) on chain with your hybrid ML-DSA-87 signature.", tx: anchor.txHash });
      setMandateSteps([...steps]);
      await new Promise((res) => setTimeout(res, 2500));
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope, anchorTx: anchor.txHash, terms: mandate.termsOf(m) }),
      });
      const body = (await res.json()) as { steps?: Step[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The agent did not answer.");
      setMandateSteps([...steps, ...(body.steps ?? [])]);
      setMaxQor("");
      await load();
    });

  const loadSamples = async () => {
    if (!account) return;
    const res = await fetch(`/api/agent/analyze?ownerEvm=${account.truth.address.evm}`, { cache: "no-store" });
    const body = (await res.json()) as { samples?: { id: string; label: string; text: string }[] };
    setSamples(body.samples ?? []);
  };

  useEffect(() => {
    if (account && unpaid.length > 0) void loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.truth.address.evm, unpaid.length]);

  const askAi = () =>
    guard("ai", async () => {
      if (!signer) return;
      setAiResult(null);
      const res = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: signer.address, invoice }),
      });
      const body = (await res.json()) as AiResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The AI could not review this.");
      setAiResult(body);
    });

  const useDraft = () => {
    const r = aiResult?.review;
    if (!r || r.decision !== "draft_mandate" || !r.matched_bill_id) return;
    setBillId(r.matched_bill_id);
    setMaxQor(r.max_pay_qor);
    if (r.mandate_note) setNote(r.mandate_note.slice(0, 280));
    document.getElementById("mandate-step")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const rogue = () =>
    guard("rogue", async () => {
      if (!signer) return;
      setRogueSteps(null);
      const res = await fetch("/api/agent/rogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: signer.address }),
      });
      const body = (await res.json()) as { steps?: Step[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The drill did not run.");
      setRogueSteps(body.steps ?? []);
      await load();
    });

  if (!signer) {
    return (
      <section className="card stack">
        <h2>Connect the account the agent will pay from</h2>
        <p>
          Testnet only. Use a wallet that signs: QoreX on testnet (phone app), or your QoreChain Dashboard wallet.
        </p>
        <ConnectPanel network="testnet" />
      </section>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}

      <section className="card stack agent-step" data-done={linked}>
        <div className="row between">
          <h2>
            <span className="num">1</span> Put the agent on a leash
          </h2>
          {linked && <span className="pill active">Linked</span>}
        </div>
        <p>
          The agent gets its own key, linked to your account with one permission: EVM calls. A spending rule says what
          that key may do. The chain checks every payment against it, so the agent never holds your keys and never
          needs an open window.
        </p>
        {!info ? (
          <p className="muted" role="status">
            <span className="spinner" />
            Reading the agent and your account…
          </p>
        ) : linked && rule ? (
          <>
            <div className="summary">
              Agent <span className="mono">{shortAddress(info.agent)}</span> may call only{" "}
              <strong>Bills.pay</strong> on <span className="mono">{shortAddress(info.bills)}</span>, at most{" "}
              <strong>{uqorToQor(rule.perTxLimit)} QOR</strong> a payment and{" "}
              <strong>{uqorToQor(rule.dailyLimit)} QOR</strong> a day, until{" "}
              <strong>{unixToDate(agentKey!.expiryUnix)}</strong>.
            </div>
            <div className="row">
              <button className="btn danger small" disabled={!!busy} onClick={revoke}>
                {busy === "revoke" ? "Revoking…" : "Revoke the agent now"}
              </button>
              {linkTx && (
                <a className="faint" href={`/tx/${linkTx}`} target="_blank" rel="noreferrer">
                  Link transaction
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="fields">
              <div className="field">
                <label htmlFor="a-pertx">Most per payment (QOR)</label>
                <input id="a-pertx" className="input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="a-daily">Most per day (QOR)</label>
                <input id="a-daily" className="input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="a-days">Link expires after (days)</label>
                <input id="a-days" className="input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </div>
            </div>
            <div className="summary">
              The agent will be able to call <strong>only Bills.pay</strong>, at most <strong>{perTx} QOR</strong> a
              payment and <strong>{daily} QOR</strong> a day, for <strong>{days} days</strong>. Linking replaces your
              account&apos;s spending rules with this one.
            </div>
            <div>
              <button className="btn accent" disabled={!!busy} onClick={link}>
                {busy === "link" ? "Signing…" : "Link the agent"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card stack agent-step" data-done={unpaid.length > 0}>
        <h2>
          <span className="num">2</span> A bill to pay
        </h2>
        <p>
          A test vendor posts bills on the Bills contract. Paying one sends the exact amount to the vendor; the
          contract keeps nothing.
        </p>
        {info && info.ownerBills.length > 0 && (
          <ul className="bill-list">
            {info.ownerBills.slice(0, 6).map((b) => (
              <li key={b.id}>
                <span className="mono">#{b.id}</span>
                <span>{uqorToQor(b.amountUqor)} QOR</span>
                <span className="mono faint">to {shortAddress(b.payee)}</span>
                <span className={`pill ${b.paid ? "" : "active"}`}>{b.paid ? "Paid" : "Unpaid"}</span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <button className="btn ghost" disabled={!!busy || !info} onClick={askBill}>
            {busy === "bill" ? "The vendor is posting…" : "Ask the vendor for a 0.4 QOR bill"}
          </button>
        </div>
      </section>

      <section className="card stack agent-step" data-done={aiResult?.review.decision === "draft_mandate"}>
        <div className="row between">
          <h2>
            <span className="num">3</span> Let the agent&apos;s AI read the invoice
          </h2>
          {info?.ai && <span className={`pill ${info.ai.ready ? "active" : ""}`}>{info.ai.ready ? info.ai.model : "AI offline"}</span>}
        </div>
        <p>
          Paste the invoice you received, an email or a message. The agent&apos;s AI checks it against the chain with its
          own tools (your unpaid bills, who you have paid before, its own leash) and decides: pay, hold, or refuse.
          It can be fooled like anyone; the chain cannot. Whatever it decides, it can never pay more than your rule allows.
        </p>
        {samples.length > 0 && (
          <div className="row">
            <span className="faint">Try one:</span>
            {samples.map((x) => (
              <button key={x.id} className="btn ghost small" onClick={() => { setInvoice(x.text); setAiResult(null); }}>
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
          <button className="btn accent" disabled={!!busy || invoice.trim().length < 10 || !info?.ai?.ready} onClick={askAi}>
            {busy === "ai" ? "The AI is checking the chain…" : "Review with the agent's AI"}
          </button>
          {!info?.ai?.ready && info && <span className="faint">The AI is not configured on this server yet.</span>}
        </div>
        {aiResult && (
          <div className="ai-result stack" data-decision={aiResult.review.decision}>
            <div className="row between">
              <strong className="ai-decision">{DECISION[aiResult.review.decision]}</strong>
              <span className={`pill risk-${aiResult.review.risk}`}>Risk: {aiResult.review.risk}</span>
            </div>
            <p>{aiResult.review.explanation}</p>
            {aiResult.review.flags.length > 0 && (
              <ul className="list warn">
                {aiResult.review.flags.map((f, i) => (
                  <li key={i}>
                    <strong>{f.kind.replace(/_/g, " ")}:</strong> {f.detail}
                  </li>
                ))}
              </ul>
            )}
            <div className="facts ai-facts">
              <div className="fact"><div className="k">Vendor</div><div className="v">{aiResult.review.extracted.vendor || "?"}</div></div>
              <div className="fact"><div className="k">Amount asked</div><div className="v">{aiResult.review.extracted.amount_qor || "?"} QOR</div></div>
              <div className="fact"><div className="k">Matches bill</div><div className="v">{aiResult.review.matched_bill_id ? `#${aiResult.review.matched_bill_id}` : "None"}</div></div>
            </div>
            <details>
              <summary className="faint">How the AI checked ({aiResult.calls.length} tool calls, {aiResult.model})</summary>
              <ol className="ai-calls">
                {aiResult.calls.map((c, i) => (
                  <li key={i}>
                    <span className="mono">{c.tool}</span> · {c.summary}
                  </li>
                ))}
              </ol>
            </details>
            {aiResult.review.decision === "draft_mandate" && aiResult.review.matched_bill_id && (
              <div>
                <button className="btn accent small" onClick={useDraft}>
                  Use this draft for the mandate
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section id="mandate-step" className="card stack agent-step" data-done={mandateSteps?.some((s) => /^Paid/.test(s.text)) ?? false}>
        <h2>
          <span className="num">4</span> Give the agent a sealed mandate
        </h2>
        <p>
          You tell the agent what to pay in a mandate. It is encrypted to the agent with ML-KEM-1024, and you sign its
          fingerprint on chain with your post-quantum key, so the agent can prove the instruction came from you.
        </p>
        {!linked ? (
          <p className="faint">Link the agent first.</p>
        ) : !selected ? (
          <p className="faint">Ask the vendor for a bill first.</p>
        ) : (
          <>
            <div className="fields">
              <div className="field">
                <label htmlFor="m-bill">Bill</label>
                <select id="m-bill" className="select" value={selected.id} onChange={(e) => { setBillId(e.target.value); setMaxQor(""); }}>
                  {unpaid.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.id}: {uqorToQor(b.amountUqor)} QOR
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-max">Pay at most (QOR)</label>
                <input id="m-max" className="input" inputMode="decimal" value={maxQor} onChange={(e) => setMaxQor(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="m-hours">Valid for (hours)</label>
                <input id="m-hours" className="input" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="m-note">Note to the agent (sealed)</label>
              <input id="m-note" className="input" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="summary">
              <strong>Mandate:</strong> pay bill <strong>#{selected.id}</strong> to{" "}
              <span className="mono">{shortAddress(selected.payee)}</span>, at most <strong>{maxQor || "?"} QOR</strong>,
              within <strong>{hours} hours</strong>. &ldquo;{note}&rdquo;
            </div>
            <div>
              <button className="btn accent" disabled={!!busy || !maxQor} onClick={sendMandate}>
                {busy === "mandate" ? "Working…" : "Seal, sign and send to the agent"}
              </button>
            </div>
          </>
        )}
        {mandateSteps && <Steps steps={mandateSteps} />}
      </section>

      <section className="card stack agent-step">
        <h2>
          <span className="num">5</span> Now try to break it
        </h2>
        <p>
          Suppose the agent&apos;s key is stolen. The thief skips the mandate and signs a payment of almost your whole
          balance to their own address. Only the chain stands in the way.
        </p>
        <div>
          <button className="btn danger" disabled={!!busy || !linked} onClick={rogue}>
            {busy === "rogue" ? "The thief is trying…" : "Play the stolen agent key"}
          </button>
        </div>
        {rogueSteps && <Steps steps={rogueSteps} />}
      </section>

      {info && (
        <p className="faint">
          Agent key <span className="mono">{info.agent}</span> · relayer <span className="mono">{info.relayer}</span> · the
          relayer pays the network fee for each call the agent signs. Testnet only.
        </p>
      )}
    </div>
  );
}
