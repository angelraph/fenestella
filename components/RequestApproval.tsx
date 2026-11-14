"use client";

import { useEffect, useRef, useState } from "react";
import {
  isFenestellaMessage,
  MAX_REASON_LENGTH,
  PROTOCOL,
  validateWindowSpec,
  type RequestMessage,
  type ResultMessage,
} from "@fenestella/connect";
import { fetchAccount, pollAccount, type AccountAnswer } from "@/lib/client";
import { isNetworkId, NETWORKS } from "@/lib/networks";
import { ConnectPanel, useWallet } from "./Wallet";
import { describeSpec } from "./WindowForm";

interface Incoming {
  request: RequestMessage;
  /** The caller's origin as the browser reported it. Never taken from the message body. */
  origin: string;
}

type Phase =
  | { kind: "waiting" }
  | { kind: "invalid"; text: string }
  | { kind: "review" }
  | { kind: "working"; text: string }
  | { kind: "done"; txHash: string }
  | { kind: "error"; text: string };

/**
 * The page a dApp opens with `requestWindow()`. It shows who is asking (the
 * origin the browser vouches for), what they ask for in plain words, and what
 * the account looks like now. The user signs in their own wallet; the caller
 * only ever learns the outcome.
 */
export function RequestApproval() {
  const wallet = useWallet();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "waiting" });
  const [account, setAccount] = useState<AccountAnswer | null>(null);
  const answered = useRef(false);

  const reply = (msg: ResultMessage, origin: string) => {
    if (answered.current) return;
    answered.current = true;
    window.opener?.postMessage(msg, origin);
  };

  // Handshake: tell the opener we are ready, then accept exactly one request from it.
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setPhase({ kind: "invalid", text: "This page is opened by a dApp that needs an EVM window. There is no request here." });
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener || !isFenestellaMessage(event.data) || event.data.type !== "request") return;
      const request = event.data;
      window.removeEventListener("message", onMessage);
      const problems = validateWindowSpec(request.spec);
      if (!isNetworkId(request.network)) problems.push("Unknown network.");
      if (typeof request.reason !== "string" || request.reason.length === 0 || request.reason.length > MAX_REASON_LENGTH) {
        problems.push("The request carries no usable reason.");
      }
      if (problems.length > 0) {
        setPhase({ kind: "invalid", text: `This request is not valid and was refused. ${problems.join(" ")}` });
        answered.current = false;
        opener.postMessage(
          { protocol: PROTOCOL, type: "result", id: String(request.id), ok: false, code: "invalid", message: problems.join(" ") } satisfies ResultMessage,
          event.origin,
        );
        answered.current = true;
        return;
      }
      setIncoming({ request, origin: event.origin });
      setPhase({ kind: "review" });
    };
    window.addEventListener("message", onMessage);
    // The opener's origin is not known yet, and "ready" carries nothing private.
    opener.postMessage({ protocol: PROTOCOL, type: "ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // If the user closes the popup without deciding, the caller's own poll reports "closed".

  const signer = wallet.signer;
  const network = incoming?.request.network ?? "testnet";

  useEffect(() => {
    if (!signer || !incoming || signer.network !== incoming.request.network) return;
    let cancelled = false;
    fetchAccount(incoming.request.network, signer.address)
      .then((a) => !cancelled && setAccount(a))
      .catch(() => !cancelled && setAccount(null));
    return () => {
      cancelled = true;
    };
  }, [signer, incoming]);

  if (phase.kind === "waiting") {
    return (
      <div className="request-page">
        <p className="muted" role="status">
          <span className="spinner" />
          Waiting for the request…
        </p>
      </div>
    );
  }
  if (phase.kind === "invalid" || !incoming) {
    return (
      <div className="request-page">
        <h2>Window request</h2>
        <div className="notice err" role="alert">
          {phase.kind === "invalid" ? phase.text : "No request."}
        </div>
      </div>
    );
  }

  const { request, origin } = incoming;
  const spec = request.spec;
  const targets = spec.allowedTargets ?? [];
  const blockSeconds = account?.truth.blockSeconds ?? 3.2;
  const truth = account?.truth;
  const wrongAccount =
    !!request.account &&
    !!truth &&
    truth.address.cosmos !== request.account &&
    truth.address.evm !== request.account.toLowerCase();
  const blocked = !truth
    ? null
    : !truth.pqc.registered
      ? "This account has no post-quantum key yet, so it cannot open a window."
      : truth.keyType === "secp256k1"
        ? "This is a coin-118 account. The EVM lane does not accept its key, so a window would do nothing."
        : null;

  const decline = () => {
    reply({ protocol: PROTOCOL, type: "result", id: request.id, ok: false, code: "rejected", message: "The user declined." }, origin);
    window.close();
  };

  const approve = async () => {
    if (!signer) return;
    setPhase({ kind: "working", text: `Approve it in ${signer.label}…` });
    try {
      const { openWindowMessage } = await import("@/lib/messages");
      const res = await signer.signAndBroadcast([openWindowMessage(signer.address, spec)], "fenestella: window request");
      setPhase({ kind: "working", text: "Signed and sent. Waiting for the chain…" });
      const { answer, settled } = await pollAccount(request.network, signer.address, (a) => a.truth.window?.live === true);
      const w = answer.truth.window;
      if (!settled || !w) throw new Error(`The transaction was sent (${res.txHash}) but the window is not live yet.`);
      reply(
        {
          protocol: PROTOCOL,
          type: "result",
          id: request.id,
          ok: true,
          txHash: res.txHash,
          account: answer.truth.address.cosmos,
          evmAddress: answer.truth.address.evm,
          window: {
            live: w.live,
            remainingBlocks: w.remainingBlocks,
            remainingTxs: w.remainingTxs,
            remainingValue: w.remainingValue,
            nativeOnly: w.nativeOnly,
            allowedTargets: w.allowedTargets,
          },
        },
        origin,
      );
      setPhase({ kind: "done", txHash: res.txHash });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong.";
      const rejected = (err as { code?: string }).code === "rejected";
      if (rejected) {
        setPhase({ kind: "review" });
        return;
      }
      setPhase({ kind: "error", text });
    }
  };

  const failAndClose = (text: string) => {
    reply({ protocol: PROTOCOL, type: "result", id: request.id, ok: false, code: "failed", message: text }, origin);
    window.close();
  };

  return (
    <div className="request-page">
      <div>
        <span className="eyebrow">Window request · {NETWORKS[network].label}</span>
        <h2 style={{ marginTop: 6 }}>This site is asking for an opening on your account</h2>
      </div>

      <div className="panel">
      <div className="stack">
        <span className="label">Asked by</span>
        <div className="origin-box">{origin}</div>
        <span className="faint">This is the address your browser reports for the site. Check that it is the one you were using.</span>
      </div>

      <div className="stack">
        <span className="label">Their reason, in their words</span>
        <div className="summary">“{request.reason}”</div>
      </div>

      <div className="stack">
        <span className="label">What you would allow</span>
        <div className="summary">{describeSpec(spec, blockSeconds)}</div>
        {targets.length > 0 && <pre className="cli">{targets.join("\n")}</pre>}
        <ul className="list warn">
          {!spec.nativeOnly && (
            <li>The cap counts native QOR only. A token approval made through the window outlives it.</li>
          )}
          {!spec.nativeOnly && targets.length === 0 && (
            <li>No targets are named: this window reaches any contract. Ask the site to name the contracts it uses.</li>
          )}
          {truth?.window?.live && <li>You already have an open window. Approving replaces it.</li>}
          <li>Anyone holding this account&apos;s classical key can use the window too, within the same bounds.</li>
        </ul>
      </div>

      {phase.kind === "done" ? (
        <div className="notice ok" role="status">
          The window is open. You can close this page and return to the site.
        </div>
      ) : phase.kind === "error" ? (
        <div className="stack">
          <div className="notice err" role="alert">
            {phase.text}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setPhase({ kind: "review" })}>
              Try again
            </button>
            <button className="btn ghost" onClick={() => failAndClose(phase.text)}>
              Tell the site it failed
            </button>
          </div>
        </div>
      ) : !signer || signer.network !== network ? (
        <div className="stack">
          <ConnectPanel network={network} />
          <button className="btn ghost" onClick={decline}>
            Decline
          </button>
        </div>
      ) : (
        <div className="stack">
          <ConnectPanel network={network} />
          {wrongAccount && (
            <div className="notice info">The site expected a different account ({request.account}). You can still decide for this one.</div>
          )}
          {blocked && <div className="notice err">{blocked}</div>}
          {phase.kind === "working" && (
            <div className="notice info" role="status">
              <span className="spinner" />
              {phase.text}
            </div>
          )}
          <div className="row">
            <button className="btn accent" disabled={phase.kind === "working" || !!blocked} onClick={approve}>
              Open this window
            </button>
            <button className="btn ghost" disabled={phase.kind === "working"} onClick={decline}>
              Decline
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
