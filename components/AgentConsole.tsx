"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAccount, type AccountAnswer } from "@/lib/client";
import { qorToUqor, shortAddress, unixToDate, uqorToQor } from "@/lib/format";
import { NETWORKS } from "@/lib/networks";
import type { Signer } from "@/lib/signer/types";
import { AgentInbox } from "./AgentInbox";
import { AiReview, type Review } from "./AiReview";
import { ConnectPanel, useWallet } from "./Wallet";

/** The account the demo video was recorded on; the AI can read for it without a wallet. */
const DEMO_OWNER = "qor1072yq0ksuukxkym8d9r0mpr3upz4awf00u5ew7";

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
  vault: string;
  paySelector: string;
  vaultState?: {
    balanceUqor: string;
    perPaymentUqor: string;
    perDayUqor: string;
    spentTodayUqor: string;
    paused: boolean;
    nonce: string;
    vendorApproved: boolean;
  };
  error?: string;
}

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

type Busy = null | "link" | "revoke" | "bill" | "mandate" | "rogue" | "ai" | "move" | "fund" | "rules" | "autopay" | "autopay-run" | "policy";

interface AutopayView {
  payee: string;
  payeeName: string | null;
  maxUqor: string;
  untilUnix: number;
  tx: string;
}

/** The Dashboard / local signer exposes its keys to this tab; QoreX never does. */
type KeyedSigner = Signer & { evmAddress: string; account: { privateKey: string; pqc: { secretKey: Uint8Array } } };
const keyed = (s: Signer | null): KeyedSigner | null => (s && "account" in s && "evmAddress" in s ? (s as KeyedSigner) : null);

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
  const [draftUsed, setDraftUsed] = useState(false);
  const [mandateSteps, setMandateSteps] = useState<Step[] | null>(null);
  const [rogueSteps, setRogueSteps] = useState<Step[] | null>(null);
  const [linkTx, setLinkTx] = useState<string | null>(null);
  const [depositQor, setDepositQor] = useState("1.5");
  const [vaultSteps, setVaultSteps] = useState<Step[] | null>(null);
  const [autopays, setAutopays] = useState<AutopayView[] | null>(null);
  const [apMax, setApMax] = useState("1");
  const [apDays, setApDays] = useState(30);
  const [autopaySteps, setAutopaySteps] = useState<Step[] | null>(null);
  const [policyText, setPolicyText] = useState("Pay Northwind Hosting, at most 1 QOR a bill and 3 QOR a day. Pay their bills automatically for the next 30 days, up to 0.5 QOR each.");
  const [policy, setPolicy] = useState<{ model: string; summary: string; proposal: { payees: { name: string; address: string }[]; perPaymentQor: string; perDayQor: string; autopay: { payee: string; payeeName: string; maxQor: string; days: number } | null; notes: string[] } } | null>(null);
  const [extraPayees, setExtraPayees] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!signer) return;
    const a = await fetchAccount("testnet", signer.address);
    setAccount(a);
    const res = await fetch(`/api/agent?owner=${signer.address}&ownerEvm=${a.truth.address.evm}`, { cache: "no-store" });
    const body = (await res.json()) as Info;
    if (!res.ok) throw new Error(body.error ?? "The agent is unavailable.");
    setInfo(body);
    const ap = await fetch(`/api/agent/autopay?owner=${signer.address}`, { cache: "no-store" });
    const apBody = (await ap.json()) as { autopays?: AutopayView[] };
    setAutopays(apBody.autopays ?? []);
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
  // An agent the owner runs themself asks to be linked with ?agent=0x…&proof=0x… (from the MCP server's link_agent tool).
  const [ownAgent, setOwnAgent] = useState<{ agent: string; proof: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = q.get("agent") ?? "";
    const p = q.get("proof") ?? "";
    if (/^0x[0-9a-fA-F]{40}$/.test(a) && /^0x[0-9a-fA-F]{130}$/.test(p)) setOwnAgent({ agent: a.toLowerCase(), proof: p });
  }, []);
  const ownKey = useMemo(() => {
    if (!ownAgent || !account) return null;
    return account.truth.abstractAccount.authenticators.find((a) => a.pubkeyHex.toLowerCase() === ownAgent.agent.slice(2)) ?? null;
  }, [ownAgent, account]);
  const ownLinked = !!ownKey && !ownKey.revoked && BigInt(ownKey.expiryUnix) > BigInt(Math.floor(Date.now() / 1000));

  const linked = !!agentKey &&!agentKey.revoked && BigInt(agentKey.expiryUnix) > BigInt(Math.floor(Date.now() / 1000));
  const rule = account?.truth.abstractAccount.rules.find((r) => r.enabled) ?? null;
  const onVault = !!info && !!rule && rule.allowedEvmCalls.some((c) => c.toLowerCase() === `${info.vault}/${info.paySelector}`.toLowerCase());
  const vs = info?.vaultState;
  const vaultReady = !!vs && BigInt(vs.balanceUqor) > 0n && BigInt(vs.perPaymentUqor) > 0n && vs.vendorApproved;
  const unpaid = info?.ownerBills.filter((b) => !b.paid) ?? [];
  const approvedPayee = (b: Bill) => !!info && b.payee === info.vendorEvm && !!info.vaultState?.vendorApproved;
  const selected = unpaid.find((b) => b.id === billId) ?? unpaid.find(approvedPayee) ?? unpaid[0] ?? null;

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

  const link = () => linkKey(info?.linkProof);

  const linkKey = (proof: { pubkey: string; possessionProof: string } | undefined, label?: string) =>
    guard("link", async () => {
      if (!signer || !info || !proof || !account) throw new Error("Connect a wallet that signs first.");
      const leash = await import("@/lib/agent/leash");
      const msgs = [
        ...(account.truth.abstractAccount.account ? [] : [leash.createAbstractAccountMessage(signer.address)]),
        ...leash.linkAgentMessagesFromProof({
          owner: signer.address,
          chainId: net.chainId,
          proof: { pubkey: fromHex(proof.pubkey), possessionProof: fromHex(proof.possessionProof) },
          terms: {
            label,
            bills: info.vault,
            selector: info.paySelector,
            perTxUqor: 1n,
            dailyUqor: 1n,
            // The chain caps a linked key's lifetime at 30 days (720 h).
            expiryUnix: Math.floor(Date.now() / 1000) + Math.min(Math.max(days, 1), 30) * 86400 - 300,
          },
        }),
      ];
      const r = await signer.signAndBroadcast(msgs, "fenestella: put the bill payer on a leash");
      setLinkTx(r.txHash);
      await new Promise((res) => setTimeout(res, 2500));
      await load();
    });

  const moveLeash = () =>
    guard("move", async () => {
      if (!signer || !info) return;
      const { vaultLeashMessage } = await import("@/lib/agent/leash");
      const r = await signer.signAndBroadcast([vaultLeashMessage(signer.address, info.vault, info.paySelector)], "fenestella: leash on the vault");
      setLinkTx(r.txHash);
      await new Promise((res) => setTimeout(res, 2500));
      await load();
    });

  const fundVault = () =>
    guard("fund", async () => {
      const k = keyed(signer);
      if (!k || !info) throw new Error("Funding the vault signs an EVM transaction in this tab, so it needs the QoreChain Dashboard wallet (testnet).");
      const amountUqor = qorToUqor(depositQor);
      if (amountUqor <= 0n || amountUqor > 5_000_000n) throw new Error("Put between 0.000001 and 5 QOR in the vault.");
      const steps: Step[] = [];
      setVaultSteps(steps);
      const { openWindowMessage } = await import("@/lib/messages");
      const w = await k.signAndBroadcast(
        [openWindowMessage(k.address, { blocks: 120, maxTxs: 1, maxValueUqor: (amountUqor + 300_000n).toString(), allowedTargets: [info.vault] })],
        "fenestella: one-call window to fund your vault",
      );
      steps.push({ ok: true, text: "Opened a one-transaction window that reaches only your vault, signed with your post-quantum key.", tx: w.txHash });
      setVaultSteps([...steps]);
      const p = (await (await fetch(`/api/vault?evm=${k.evmAddress}`, { cache: "no-store" })).json()) as { nonce: number; gasPrice: string; chainId: number; error?: string };
      if (p.error) throw new Error(p.error);
      const [{ privateKeyToAccount }, { encodeFunctionData }, { VAULT_ABI }] = await Promise.all([import("viem/accounts"), import("viem"), import("@/lib/agent/vault")]);
      const raw = await privateKeyToAccount(k.account.privateKey as `0x${string}`).signTransaction({
        chainId: p.chainId,
        type: "legacy",
        nonce: p.nonce,
        gasPrice: BigInt(p.gasPrice),
        gas: 120_000n,
        to: info.vault as `0x${string}`,
        value: amountUqor * 1_000_000_000_000n,
        data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [k.evmAddress as `0x${string}`] }),
      });
      const res = await fetch("/api/vault", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "deposit", raw }) });
      const body = (await res.json()) as { tx?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The deposit failed.");
      steps.push({ ok: true, text: `Put ${depositQor} QOR in your vault. The window was used up by this one transaction.`, tx: body.tx });
      setVaultSteps([...steps]);
      await load();
    });

  const draftRules = () =>
    guard("policy", async () => {
      if (!signer) return;
      setPolicy(null);
      const res = await fetch("/api/agent/policy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: signer.address, text: policyText }) });
      const body = (await res.json()) as typeof policy & { error?: string };
      if (!res.ok || !body) throw new Error(body?.error ?? "The AI could not draft rules.");
      setPolicy(body);
    });

  const usePolicy = () => {
    if (!policy || !info) return;
    const p = policy.proposal;
    if (p.perPaymentQor) setPerTx(p.perPaymentQor);
    if (p.perDayQor) setDaily(p.perDayQor);
    setExtraPayees(p.payees.map((x) => x.address).filter((a) => a !== info.vendorEvm));
    if (p.autopay) {
      setApMax(p.autopay.maxQor);
      setApDays(p.autopay.days);
    }
  };

  const signRules = () =>
    guard("rules", async () => {
      const k = keyed(signer);
      if (!k || !info?.vaultState) throw new Error("Signing vault rules uses your ML-DSA-87 key in this tab, so it needs the QoreChain Dashboard wallet (testnet).");
      const [{ pqcSign }, vault, { bytesToHex, hexToBytes }] = await Promise.all([import("@qorechain/sdk"), import("@/lib/agent/vault"), import("viem")]);
      const QOR = 1_000_000_000_000n;
      const admins: import("@/lib/agent/vault").VaultAdmin[] = [];
      if (!info.vaultState.vendorApproved) admins.push({ action: "payee", payee: info.vendorEvm as `0x${string}`, approved: true });
      for (const extra of extraPayees.slice(0, 2)) admins.push({ action: "payee", payee: extra as `0x${string}`, approved: true });
      admins.push({ action: "limits", token: vault.NATIVE, perPayment: qorToUqor(perTx) * QOR, perDay: qorToUqor(daily) * QOR });
      const nonce = BigInt(info.vaultState.nonce);
      const items = admins.map((admin, i) => ({
        admin: JSON.parse(JSON.stringify(admin, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
        signature: bytesToHex(pqcSign(k.account.pqc.secretKey, hexToBytes(vault.adminMessage({ chainId: net.evmChainId, owner: k.evmAddress.toLowerCase() as `0x${string}`, nonce: nonce + BigInt(i), admin })))),
      }));
      setVaultSteps([{ ok: true, text: `Signed ${items.length === 1 ? "the limits" : "the payee and the limits"} in this tab with your ML-DSA-87 key (4,627-byte signatures). The relayer sends them; the vault checks each with pqcVerify.` }]);
      const res = await fetch("/api/vault", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "admin", ownerEvm: k.evmAddress, items }) });
      const body = (await res.json()) as { steps?: Step[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The vault did not accept the rules.");
      setVaultSteps((s) => [...(s ?? []), ...(body.steps ?? [])]);
      await load();
    });

  const setAutopay = (on: boolean, payee: string) =>
    guard("autopay", async () => {
      if (!signer) return;
      const ap = await import("@/lib/agent/autopay");
      const memo = on
        ? ap.autopayOnMemo(payee, qorToUqor(apMax), Math.floor(Date.now() / 1000) + Math.min(apDays, ap.AUTOPAY_MAX_DAYS) * 86400)
        : ap.autopayOffMemo(payee);
      const r = await signer.signAndBroadcast([ap.autopayMessage(signer.address)], memo);
      setAutopaySteps([
        {
          ok: true,
          text: on
            ? `You signed a standing permission with your post-quantum key: the agent may pay bills from this payee, up to ${apMax} QOR each, for ${apDays} days. It is a memo on a 1 uqor transfer to yourself, so anyone can read it and only you could have written it.`
            : "You turned autopay off for this payee. The agent reads this from the chain before every round.",
          tx: r.txHash,
        },
      ]);
      await new Promise((res) => setTimeout(res, 2500));
      await load();
    });

  const runAutopayNow = () =>
    guard("autopay-run", async () => {
      if (!signer) return;
      const res = await fetch("/api/agent/autopay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: signer.address }) });
      const body = (await res.json()) as { steps?: Step[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The agent did not run.");
      setAutopaySteps(body.steps ?? []);
      await load();
    });

  const revoke = () => revokeKey(info?.agent);

  const revokeKey = (agentAddr: string | undefined) =>
    guard("revoke", async () => {
      if (!signer || !agentAddr) return;
      const { revokeAgentMessage } = await import("@/lib/agent/leash");
      await signer.signAndBroadcast([revokeAgentMessage(signer.address, agentAddr)], "fenestella: revoke the bill payer");
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

  const useDraft = (r: Review) => {
    if (r.decision !== "draft_mandate" || !r.matched_bill_id) return;
    setBillId(r.matched_bill_id);
    setMaxQor(r.max_pay_qor);
    if (r.mandate_note) setNote(r.mandate_note.slice(0, 280));
    setDraftUsed(true);
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
      <>
      <section className="card stack">
        <h2>Connect the account the agent will pay from</h2>
        {ownAgent && (
          <div className="notice info">
            Your own agent (<span className="mono">{shortAddress(ownAgent.agent)}</span>, from the Fenestella MCP server) is
            asking to be linked. Connect the account it should pay from, then you can link it.
          </div>
        )}
        <p>
          Testnet only. Use a wallet that signs: QoreX on testnet (phone app), or your QoreChain Dashboard wallet.
        </p>
        <ConnectPanel network="testnet" />
      </section>
      <DemoAi />
      </>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}

      {ownAgent && (
        <section className="card stack agent-step" id="own-agent" data-done={ownLinked}>
          <div className="row between">
            <h2>Leash your own agent</h2>
            {ownLinked && <span className="pill active">Linked</span>}
          </div>
          <p>
            An agent you run yourself (the Fenestella MCP server, in Claude or any MCP client) asked to be linked to this
            account. It gets the same leash as Fenestella&apos;s agent: it may call only <strong>AgentVault.payBill</strong>,
            and move at most 0.000001 QOR of your own balance. It pays only payees you approved in your vault, within your
            limits. Its key never leaves the machine it runs on.
          </p>
          <div className="summary">
            Agent key <span className="mono">{ownAgent.agent}</span>
            {ownLinked && ownKey ? <> · linked until <strong>{unixToDate(ownKey.expiryUnix)}</strong></> : null}
          </div>
          {!info ? null : ownLinked ? (
            <div className="row">
              <button className="btn danger small" disabled={!!busy} onClick={() => revokeKey(ownAgent.agent)}>
                {busy === "revoke" ? "Revoking…" : "Revoke this agent now"}
              </button>
            </div>
          ) : (
            <div className="row">
              <button className="btn accent" disabled={!!busy} onClick={() => linkKey({ pubkey: ownAgent.agent.slice(2), possessionProof: ownAgent.proof.slice(2) }, "Own agent (MCP)")}>
                {busy === "link" ? "Signing…" : `Link this agent for ${Math.min(Math.max(days, 1), 30)} days`}
              </button>
            </div>
          )}
          {linkTx && (
            <a className="faint" href={`/tx/${linkTx}`} target="_blank" rel="noreferrer">
              Link transaction
            </a>
          )}
        </section>
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
          that key may do: call <strong>one function of your vault</strong>, and move at most 0.000001 QOR of your own
          balance. The chain checks every call against it, so a stolen agent key cannot send your money anywhere.
        </p>
        {!info ? (
          <p className="muted" role="status">
            <span className="spinner" />
            Reading the agent and your account…
          </p>
        ) : linked && rule ? (
          <>
            {onVault ? (
              <div className="summary">
                Agent <span className="mono">{shortAddress(info.agent)}</span> may call only{" "}
                <strong>AgentVault.payBill</strong>, and move at most <strong>{rule.perTxLimit} uqor</strong> of your own
                balance a day, until <strong>{unixToDate(agentKey!.expiryUnix)}</strong>. Everything it pays comes from your vault.
              </div>
            ) : (
              <div className="notice info">
                The agent is linked with the older leash: it may move up to <strong>{uqorToQor(rule.perTxLimit)} QOR</strong> a
                payment from your own balance, to anyone. Move it onto your vault so it can pay only bills, only to payees you approve.
                <div style={{ marginTop: 10 }}>
                  <button className="btn accent small" disabled={!!busy} onClick={moveLeash}>
                    {busy === "move" ? "Signing…" : "Move the leash onto my vault"}
                  </button>
                </div>
              </div>
            )}
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
                <label htmlFor="a-days">Link expires after (days, at most 30)</label>
                <input id="a-days" className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.min(30, Number(e.target.value)))} />
              </div>
            </div>
            <div className="summary">
              The agent will be able to call <strong>only AgentVault.payBill</strong>, and move at most{" "}
              <strong>0.000001 QOR</strong> of your own balance, for <strong>{days} days</strong>. Linking replaces your
              account&apos;s spending rules with this one. You set what it may pay in the next step.
            </div>
            <div>
              <button className="btn accent" disabled={!!busy} onClick={link}>
                {busy === "link" ? "Signing…" : "Link the agent"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card stack agent-step" data-done={vaultReady}>
        <div className="row between">
          <h2>
            <span className="num">2</span> Fund your vault and set its rules
          </h2>
          {vs?.paused && <span className="pill">Paused</span>}
        </div>
        <p>
          The agent pays only from your vault, a contract with no admin. You decide who it may pay and how much, and you
          sign those rules with your <strong>post-quantum key</strong>: the vault checks every signature with the
          chain&apos;s pqcVerify. A stolen classical key or agent key cannot change them.
        </p>
        {vs && (
          <div className="facts ai-facts">
            <div className="fact"><div className="k">In the vault</div><div className="v">{uqorToQor(vs.balanceUqor)} QOR</div></div>
            <div className="fact"><div className="k">Limits</div><div className="v">{BigInt(vs.perPaymentUqor) > 0n ? `${uqorToQor(vs.perPaymentUqor)} a payment, ${uqorToQor(vs.perDayUqor)} a day` : "None yet: nothing can be paid"}</div></div>
            <div className="fact"><div className="k">Approved payee</div><div className="v">{vs.vendorApproved ? "Northwind Hosting (test vendor)" : "None yet"}</div></div>
          </div>
        )}
        {!keyed(signer) ? (
          <p className="faint">
            Funding the vault and signing its rules happen in this tab, so they need the QoreChain Dashboard wallet on
            testnet. QoreX does not sign raw EVM transactions or arbitrary bytes.
          </p>
        ) : (
          <>
            <div className="policy-box stack">
              <label htmlFor="v-policy">
                <strong>Or just say it.</strong> <span className="faint">The agent&apos;s AI turns your words into these rules; Fenestella checks them; you sign.</span>
              </label>
              <textarea id="v-policy" className="input" rows={3} value={policyText} onChange={(e) => setPolicyText(e.target.value)} />
              <div className="row">
                <button className="btn ghost small" disabled={!!busy || policyText.trim().length < 8 || !info?.ai?.ready} onClick={draftRules}>
                  {busy === "policy" ? "The AI is reading…" : "Let the AI write my rules"}
                </button>
              </div>
              {policy && (
                <div className="ai-result stack" data-decision="draft_mandate">
                  <p>
                    <strong>The AI understood:</strong> {policy.summary} <span className="faint">({policy.model})</span>
                  </p>
                  <div className="facts ai-facts">
                    <div className="fact"><div className="k">Payees</div><div className="v">{policy.proposal.payees.map((x) => x.name).join(", ") || "None"}</div></div>
                    <div className="fact"><div className="k">Limits</div><div className="v">{policy.proposal.perPaymentQor || "?"} a payment, {policy.proposal.perDayQor || "?"} a day</div></div>
                    <div className="fact"><div className="k">Autopay</div><div className="v">{policy.proposal.autopay ? `${policy.proposal.autopay.payeeName}, up to ${policy.proposal.autopay.maxQor}, ${policy.proposal.autopay.days} days` : "Off"}</div></div>
                  </div>
                  {policy.proposal.notes.length > 0 && (
                    <div className="notice ai-guard">
                      <strong>Fenestella&apos;s checks:</strong>
                      <ul className="list">
                        {policy.proposal.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <button className="btn accent small" onClick={usePolicy}>
                      Use these rules (you still sign them below)
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="fields">
              <div className="field">
                <label htmlFor="v-dep">Put in the vault (QOR)</label>
                <input id="v-dep" className="input" inputMode="decimal" value={depositQor} onChange={(e) => setDepositQor(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="a-pertx">Most per payment (QOR)</label>
                <input id="a-pertx" className="input" inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="a-daily">Most per day (QOR)</label>
                <input id="a-daily" className="input" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <button className="btn ghost" disabled={!!busy || !info} onClick={fundVault}>
                {busy === "fund" ? "Funding…" : `Put ${depositQor} QOR in my vault`}
              </button>
              <button className="btn accent" disabled={!!busy || !info} onClick={signRules}>
                {busy === "rules" ? "Signing…" : vs?.vendorApproved ? "Sign new limits" : "Approve the vendor and sign the limits"}
              </button>
            </div>
          </>
        )}
        {vaultSteps && <Steps steps={vaultSteps} />}
      </section>

      <section className="card stack agent-step" data-done={unpaid.length > 0}>
        <h2>
          <span className="num">3</span> A bill to pay
        </h2>
        <p>
          A test vendor posts a bill to your vault. Anyone can send you a bill; only payees you approved can be paid.
        </p>
        {info && info.ownerBills.length > 0 && (
          <ul className="bill-list">
            {info.ownerBills.slice(0, 6).map((b) => (
              <li key={b.id}>
                <span className="mono">#{b.id}</span>
                <span>{uqorToQor(b.amountUqor)} QOR</span>
                <span className="mono faint">to {shortAddress(b.payee)}</span>
                {!approvedPayee(b) && <span className="pill risk-high">Payee not approved</span>}
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

      <section className="card stack agent-step" data-done={draftUsed}>
        <div className="row between">
          <h2>
            <span className="num">4</span> Let the agent&apos;s AI read the invoice
          </h2>
          {info?.ai && <span className={`pill ${info.ai.ready ? "active" : ""}`}>{info.ai.ready ? info.ai.model : "AI offline"}</span>}
        </div>
        <p>
          Paste the invoice you received, an email or a message. The agent&apos;s AI checks it against the chain with its
          own tools (your unpaid bills, who you have paid before, its own leash) and decides: pay, hold, or refuse.
          It can be fooled like anyone; the chain and your vault cannot. Whatever it decides, it can never pay more than your limits, or anyone you did not approve.
        </p>
        {account && (
          <AiReview
            owner={signer.address}
            ownerEvm={account.truth.address.evm}
            ai={info?.ai ?? null}
            reloadKey={unpaid.length}
            onUseDraft={useDraft}
          />
        )}
      </section>

      <section id="mandate-step" className="card stack agent-step" data-done={mandateSteps?.some((s) => /^Paid/.test(s.text)) ?? false}>
        <h2>
          <span className="num">5</span> Give the agent a sealed mandate
        </h2>
        <p>
          You tell the agent what to pay in a mandate. It is encrypted to the agent with ML-KEM-1024, and you sign its
          fingerprint on chain with your post-quantum key, so the agent can prove the instruction came from you.
        </p>
        {!linked ? (
          <p className="faint">Link the agent first.</p>
        ) : !onVault ? (
          <p className="faint">Move the agent&apos;s leash onto your vault first (step 1).</p>
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

      <section className="card stack agent-step" data-done={(autopays?.length ?? 0) > 0}>
        <div className="row between">
          <h2>
            <span className="num">6</span> Let it pay on its own: autopay
          </h2>
          {(autopays?.length ?? 0) > 0 && <span className="pill active">Autopay on</span>}
        </div>
        <p>
          A mandate per bill is safe but slow. Autopay is a standing permission you sign once with your post-quantum key:
          the agent may pay bills from one payee, up to an amount, until a date. It checks on its own every few hours. Every
          payment still has to pass your vault (approved payee, your limits) and the agent&apos;s AI. Turning it off is one
          more signature, and it takes effect on the next round.
        </p>
        {autopays && autopays.length > 0 && (
          <ul className="bill-list">
            {autopays.map((a) => (
              <li key={a.payee}>
                <span>{a.payeeName ?? shortAddress(a.payee)}</span>
                <span>up to {uqorToQor(a.maxUqor)} QOR a bill</span>
                <span className="faint">until {unixToDate(String(a.untilUnix))}</span>
                <a className="mono faint" href={`/tx/${a.tx}`} target="_blank" rel="noreferrer">signed</a>
                <button className="btn ghost small" disabled={!!busy} onClick={() => setAutopay(false, a.payee)}>
                  Turn off
                </button>
              </li>
            ))}
          </ul>
        )}
        {!onVault ? (
          <p className="faint">Move the agent&apos;s leash onto your vault first (step 1).</p>
        ) : info && !(autopays ?? []).some((a) => a.payee === info.vendorEvm) ? (
          <>
            <div className="fields">
              <div className="field">
                <label htmlFor="ap-max">Most per bill (QOR)</label>
                <input id="ap-max" className="input" inputMode="decimal" value={apMax} onChange={(e) => setApMax(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ap-days">For (days, at most 90)</label>
                <input id="ap-days" className="input" type="number" min={1} max={90} value={apDays} onChange={(e) => setApDays(Number(e.target.value))} />
              </div>
            </div>
            <div className="summary">
              <strong>Autopay:</strong> the agent may pay bills from <strong>Northwind Hosting</strong> (
              <span className="mono">{shortAddress(info.vendorEvm)}</span>), up to <strong>{apMax} QOR</strong> each,
              for <strong>{apDays} days</strong>. Your vault&apos;s limits still apply.
            </div>
          </>
        ) : null}
        <div className="row">
          {onVault && info && !(autopays ?? []).some((a) => a.payee === info.vendorEvm) && (
            <button className="btn accent" disabled={!!busy} onClick={() => setAutopay(true, info.vendorEvm)}>
              {busy === "autopay" ? "Signing…" : "Turn on autopay for Northwind"}
            </button>
          )}
          <button className="btn ghost" disabled={!!busy || !onVault} onClick={runAutopayNow}>
            {busy === "autopay-run" ? "The agent is checking…" : "Let the agent check now"}
          </button>
        </div>
        {autopaySteps && <Steps steps={autopaySteps} />}
      </section>

      <section className="card stack agent-step">
        <h2>
          <span className="num">7</span> Messages from your agent
        </h2>
        <p>
          After every payment the agent writes you a report: what it paid, to whom, on what authority, and why its AI
          agreed. It signs the report with its own on-chain post-quantum identity and seals it to your published
          encryption key, so only you can read it and you can prove who wrote it. Your sealed mandates go one way, these
          reports come back the other.
        </p>
        {account && (
          <AgentInbox signer={signer} ownerEvm={account.truth.address.evm} kemPublished={account.truth.kem.found} onChange={() => void load()} />
        )}
      </section>

      <section className="card stack agent-step">
        <h2>
          <span className="num">8</span> Now try to break it
        </h2>
        <p>
          Suppose the agent&apos;s key is stolen. The thief skips the mandate and tries three things: send most of your
          balance to their own address, approve themselves as a payee in your vault, and get the agent key to pay a bill
          they sent you. Only the chain and your vault stand in the way.
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

/** For visitors without a wallet: the agent's AI, reading for the demo account. Read-only. */
function DemoAi() {
  const [evm, setEvm] = useState<string | null>(null);
  const [ai, setAi] = useState<{ ready: boolean; model: string } | null>(null);
  useEffect(() => {
    fetchAccount("testnet", DEMO_OWNER)
      .then(async (a) => {
        setEvm(a.truth.address.evm);
        const r = await fetch(`/api/agent?owner=${DEMO_OWNER}`, { cache: "no-store" });
        const b = (await r.json()) as { ai?: { ready: boolean; model: string } };
        setAi(b.ai ?? null);
      })
      .catch(() => undefined);
  }, []);
  return (
    <section className="card stack agent-step" id="try-the-ai">
      <div className="row between">
        <h2>No wallet? Watch the agent&apos;s AI catch a scam</h2>
        {ai && <span className={`pill ${ai.ready ? "active" : ""}`}>{ai.ready ? ai.model : "AI offline"}</span>}
      </div>
      <p>
        The AI reads invoices for <a href={`/account/${DEMO_OWNER}?network=testnet`}>the demo account</a>, which has the
        agent linked, a funded vault and a real unpaid bill on chain. Pick the phishing or the prompt-injection sample and watch it check
        the chain with its tools and refuse. This only reads; nothing is signed or paid.
      </p>
      {evm ? <AiReview owner={DEMO_OWNER} ownerEvm={evm} ai={ai} /> : <p className="faint">Reading the demo account…</p>}
    </section>
  );
}
