import Link from "next/link";
import { fetchTx, EXECUTION_FAILED_EVENT } from "@/lib/chain/tx";
import { NETWORKS } from "@/lib/networks";
import { uqorToQor } from "@/lib/format";

export const dynamic = "force-dynamic";

const net = NETWORKS.testnet;

interface EvmReceipt {
  status: string;
  blockNumber: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
  gasUsed: string;
}

async function evmReceipt(hash: string): Promise<EvmReceipt | null> {
  const res = await fetch(net.evmRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { result?: EvmReceipt | null };
  return body.result ?? null;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v" style={{ wordBreak: "break-all" }}>
        {children}
      </div>
    </div>
  );
}

const short = (t: string) => t.split(".").pop()?.replace(/^Msg/, "") ?? t;

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const isEvm = /^0x[0-9a-fA-F]{64}$/.test(hash);
  const isNative = /^[0-9A-Fa-f]{64}$/.test(hash);

  const header = (
    <>
      <span className="eyebrow">Transaction receipt · qorechain-diana</span>
      <h1 style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)" }}>Read straight from the chain</h1>
      <p className="mono faint" style={{ wordBreak: "break-all" }}>
        {hash}
      </p>
    </>
  );

  if (!isEvm && !isNative) {
    return (
      <article className="prose">
        {header}
        <div className="notice err">That is not a transaction hash.</div>
      </article>
    );
  }

  if (isEvm) {
    const r = await evmReceipt(hash).catch(() => null);
    return (
      <article className="prose">
        {header}
        {!r ? (
          <div className="notice err">The testnet EVM node does not know this transaction.</div>
        ) : (
          <>
            <div className={`notice ${r.status === "0x1" ? "ok" : "err"}`}>
              {r.status === "0x1" ? "Succeeded" : "Reverted"} on the EVM lane, block {Number(r.blockNumber).toLocaleString("en-US")}.
            </div>
            <div className="facts">
              <Row k="From">{r.from}</Row>
              <Row k={r.contractAddress ? "Created contract" : "To"}>{r.contractAddress ?? r.to}</Row>
              <Row k="Gas used">{Number(r.gasUsed).toLocaleString("en-US")}</Row>
            </div>
          </>
        )}
        <p className="faint">
          Source: <code>eth_getTransactionReceipt</code> on {net.evmRpc}.
        </p>
      </article>
    );
  }

  const tx = await fetchTx(net.rest, hash.toUpperCase()).catch(() => null);
  if (!tx) {
    return (
      <article className="prose">
        {header}
        <div className="notice err">The testnet does not know this transaction (yet). If it was just sent, reload in a few seconds.</div>
      </article>
    );
  }

  const failed = tx.events.filter((e) => e.type === EXECUTION_FAILED_EVENT);
  const hybridVerified = tx.events.some((e) => e.type === "pqc_hybrid_verify");
  const fee = tx.events.find((e) => e.type === "tx" && e.attributes.fee)?.attributes.fee ?? "";
  const feeUqor = /^(\d+)uqor$/.exec(fee)?.[1];
  const ok = tx.code === 0 && failed.length === 0;

  return (
    <article className="prose">
      {header}
      <div className={`notice ${ok ? "ok" : "err"}`}>
        {tx.code !== 0
          ? `Refused by the chain (${tx.codespace} code ${tx.code}): ${tx.rawLog.slice(0, 300)}`
          : failed.length > 0
            ? `Delivered, but the chain refused what it asked: ${failed.map((f) => f.attributes.reason).join("; ")}`
            : `Succeeded in block ${Number(tx.height).toLocaleString("en-US")}.`}
      </div>
      <div className="facts">
        <Row k="Time">{tx.timestamp.replace("T", " ").replace("Z", " UTC")}</Row>
        <Row k="Block">{Number(tx.height).toLocaleString("en-US")}</Row>
        <Row k="Post-quantum signature">
          <span className={`dot ${tx.hybrid || hybridVerified ? "good" : "warn"}`} />
          {tx.hybrid || hybridVerified ? "ML-DSA-87 hybrid, verified" : "Not present"}
        </Row>
        <Row k="Messages">{tx.messages.map((m) => short(m["@type"])).join(", ")}</Row>
        <Row k="Fee">{feeUqor ? `${uqorToQor(feeUqor)} QOR` : fee || "?"}</Row>
        <Row k="Signer">{tx.signers[0] ?? "?"}</Row>
      </div>
      {tx.memo && (
        <div className="summary">
          Memo: <span className="mono">{tx.memo}</span>
        </div>
      )}
      <p className="faint">
        Raw data:{" "}
        <a href={`${net.rest}/cosmos/tx/v1beta1/txs/${tx.hash}`} target="_blank" rel="noreferrer">
          testnet REST
        </a>{" "}
        · QoreChain explorer:{" "}
        <a href={`${net.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          open
        </a>{" "}
        (switch it to Testnet at the top first; it opens on mainnet). <Link href="/">Back to the console</Link>
      </p>
    </article>
  );
}
