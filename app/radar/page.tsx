import { SealMyAccount } from "@/components/SealMyAccount";

export const metadata = { title: "Q-Day radar · Fenestella" };
export const revalidate = 600;

type Levels = { sealed: number; scoped: number; open: number; takeover: number; unknown: number };
interface Snapshot {
  network: "testnet" | "mainnet";
  chainId: string;
  scannedAt: string;
  durationMs: number;
  accounts: number;
  notExposedYet: number;
  exposed: number;
  scanned: number;
  levels: Levels;
  pqcRegistered: number;
  kemKeys: number;
  liveWindows: number;
  agentAccounts: number;
  failed: number;
  valueAtRiskUqor: string;
  valueBehindOpenWindowsUqor: string;
  valueSealedUqor: string;
  history: { at: string; exposed: number; levels: Levels; valueAtRiskUqor: string }[];
}

const DATA = (n: string) => `https://raw.githubusercontent.com/angelraph/fenestella/radar-data/radar/${n}.json`;

async function load(n: "testnet" | "mainnet"): Promise<Snapshot | null> {
  try {
    const r = await fetch(DATA(n), { next: { revalidate: 600 } });
    if (r.ok) return (await r.json()) as Snapshot;
    // A miss (for example while GitHub's CDN catches up with a new file) is not cached: ask again, fresh.
    const fresh = await fetch(DATA(n), { cache: "no-store" });
    return fresh.ok ? ((await fresh.json()) as Snapshot) : null;
  } catch {
    return null;
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "0%");
const qor = (u: string) => (Number(BigInt(u || "0")) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const SEGMENTS: { key: keyof Levels; label: string }[] = [
  { key: "takeover", label: "Can be taken over" },
  { key: "open", label: "Wide open window" },
  { key: "scoped", label: "Scoped window" },
  { key: "sealed", label: "Sealed" },
  { key: "unknown", label: "Could not read" },
];

function Trend({ s }: { s: Snapshot }) {
  const pts = s.history.slice(-60);
  if (pts.length < 2) return <p className="faint">The trend line appears after the next scans (every six hours).</p>;
  const w = 520;
  const h = 90;
  const share = pts.map((p) => (p.exposed ? p.levels.takeover / p.exposed : 0));
  const max = Math.max(...share, 0.01);
  const d = share.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="radar-trend" role="img" aria-label="Share of exposed accounts that can be taken over, over time">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Network({ s }: { s: Snapshot }) {
  const exposedRead = SEGMENTS.reduce((n, x) => n + (s.levels[x.key] ?? 0), 0) || 1;
  return (
    <section className="card stack radar-net">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{s.network === "mainnet" ? "Mainnet" : "Testnet"}</h2>
        <span className="faint">
          Scanned {new Date(s.scannedAt).toUTCString().replace(" GMT", " UTC")} · {s.scanned.toLocaleString("en-US")} accounts read in{" "}
          {Math.round(s.durationMs / 1000)}s
        </span>
      </div>
      <div className="radar-stats">
        <div className="radar-stat danger">
          <div className="v">{s.levels.takeover.toLocaleString("en-US")}</div>
          <div className="k">accounts a quantum attacker could take today</div>
          <div className="faint">{pct(s.levels.takeover, exposedRead)} of exposed accounts</div>
        </div>
        <div className="radar-stat danger">
          <div className="v">{qor(s.valueAtRiskUqor)} QOR</div>
          <div className="k">sitting in those accounts</div>
        </div>
        <div className="radar-stat">
          <div className="v">{s.levels.sealed.toLocaleString("en-US")}</div>
          <div className="k">sealed: the classical key alone moves nothing</div>
          <div className="faint">{qor(s.valueSealedUqor)} QOR protected</div>
        </div>
        <div className="radar-stat">
          <div className="v">{(s.levels.open + s.levels.scoped).toLocaleString("en-US")}</div>
          <div className="k">with an EVM window open right now</div>
          <div className="faint">{s.levels.open} wide open, {s.levels.scoped} scoped</div>
        </div>
      </div>
      <div className="radar-bar" aria-label="How exposed accounts break down">
        {SEGMENTS.filter((x) => s.levels[x.key]).map((x) => (
          <span key={x.key} data-level={x.key} style={{ flexGrow: s.levels[x.key] }} title={`${x.label}: ${s.levels[x.key]}`} />
        ))}
      </div>
      <div className="radar-legend">
        {SEGMENTS.filter((x) => s.levels[x.key]).map((x) => (
          <span key={x.key} data-level={x.key}>
            <i /> {x.label} · {s.levels[x.key].toLocaleString("en-US")}
          </span>
        ))}
      </div>
      <p className="faint">
        {s.accounts.toLocaleString("en-US")} accounts in all. {s.notExposedYet.toLocaleString("en-US")} have never signed, so their
        public key is not on chain yet and there is nothing to recover; they become exposed with their first transaction.{" "}
        {s.pqcRegistered.toLocaleString("en-US")} have a post-quantum key, {s.kemKeys.toLocaleString("en-US")} have published an encryption key,
        and {s.agentAccounts.toLocaleString("en-US")} have a linked agent or wallet key.
      </p>
      <div>
        <div className="faint" style={{ marginBottom: 6 }}>Share of exposed accounts that can be taken over, scan by scan</div>
        <Trend s={s} />
      </div>
    </section>
  );
}

export default async function RadarPage() {
  const [mainnet, testnet] = await Promise.all([load("mainnet"), load("testnet")]);
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Q-Day radar · the whole chain</span>
        <h1 style={{ maxWidth: "16ch" }}>
          How much of QoreChain is <span className="hl">ready for Q-Day?</span>
        </h1>
        <p className="lede">
          Every account on mainnet and testnet, read every six hours with the same checks as the console: does it have a
          post-quantum key, is an EVM window open, how wide. Only totals are shown, never an address, so the radar never
          points an attacker at anyone.
        </p>
      </section>

      <section className="card stack" id="seal">
        <h2 style={{ margin: 0 }}>Is your account one of them?</h2>
        <SealMyAccount />
      </section>

      {mainnet && <Network s={mainnet} />}
      {testnet && <Network s={testnet} />}
      {!mainnet && !testnet && <p className="notice info">The first scan has not been published yet. It runs every six hours.</p>}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>How the radar works</h2>
        <p>
          A scheduled job lists every account on each network, skips the ones whose public key has never appeared on chain,
          and reads the rest: ML-DSA-87 registration and proof of possession, the EVM window, linked keys and spending rules,
          and the balance. Each account gets the same verdict the console gives one account. The totals are published to
          the repository&apos;s <code>radar-data</code> branch, with their history, so anyone can check them. The scanner is{" "}
          <a href="https://github.com/angelraph/fenestella/blob/main/scripts/radar-scan.ts">scripts/radar-scan.ts</a>.
        </p>
      </section>
    </>
  );
}
