import Link from "next/link";
import { Aperture } from "@/components/Aperture";
import { LiveShowcase, type ShowcaseData } from "@/components/LiveShowcase";
import { Lookup } from "@/components/Lookup";
import { Reveal } from "@/components/Reveal";
import type { ExposureLevel } from "@/lib/exposure";
import stats from "@/lib/generated/stats.json";
import { loadActivity, loadRadar, type RadarTotals } from "@/lib/site-data";

export const revalidate = 120;

const STATES: { level: ExposureLevel; name: string; line: string }[] = [
  {
    level: "sealed",
    name: "Sealed",
    line: "Post-quantum key registered, no window open. A stolen classical key moves nothing.",
  },
  {
    level: "scoped",
    name: "Scoped opening",
    line: "A window for named contracts or plain transfers only, with a count, a cap and an expiry.",
  },
  {
    level: "open",
    name: "Wide open",
    line: "A window with no scope. Any contract, any recipient, until it runs out.",
  },
  {
    level: "takeover",
    name: "Can be taken over",
    line: "No post-quantum key yet. Whoever holds the classical key can register theirs first.",
  },
];

function qor(u: string): string {
  const v = Number(BigInt(u || "0")) / 1e6;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} billion`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} million`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const LAB_GROUPS: { label: string; pattern: RegExp }[] = [
  { label: "Stolen classical key", pattern: /^classical-/ },
  { label: "Stolen agent key", pattern: /^agent-/ },
  { label: "Forged, tampered or replayed", pattern: /^(forged-|tampered-|fake-|replay-)/ },
  { label: "Fooling the AI", pattern: /^ai-/ },
];
const NAMES: Record<string, string> = {
  AgentVaultTest: "AgentVault",
  ReceiptsTest: "Receipts",
  BillsTest: "Bills",
  AgentReportsTest: "Reports",
  exposure: "exposure",
  connect: "requests",
  autopay: "autopay",
  guard: "AI guard",
  policy: "plain English",
  "request-link": "agent links",
  stats: "numbers",
};

function radarCard(r: RadarTotals): ShowcaseData["radar"][number] {
  return {
    network: r.network,
    scannedAt: r.scannedAt,
    takeover: r.levels.takeover,
    atRiskQor: qor(r.valueAtRiskUqor),
    sealed: r.levels.sealed,
    sealedQor: qor(r.valueSealedUqor),
    windows: r.levels.open + r.levels.scoped,
    exposed: r.exposed,
  };
}

export default async function Home() {
  const [mainnet, testnet, feed] = await Promise.all([loadRadar("mainnet"), loadRadar("testnet"), loadActivity(8)]);
  const byDesc = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([name, n]) => ({ name: NAMES[name] ?? name, n }))
      .sort((a, b) => b.n - a.n);
  const data: ShowcaseData = {
    attacks: stats.attacks,
    attackGroups: LAB_GROUPS.map((g) => ({ label: g.label, n: stats.attackIds.filter((id) => g.pattern.test(id)).length })),
    unitTests: stats.unitTests,
    unitByFile: byDesc(stats.unitByFile),
    contractTests: stats.contractTests,
    contractBySuite: byDesc(stats.contractBySuite),
    browserTests: stats.browserTests,
    radar: [mainnet, testnet].filter((r): r is RadarTotals => !!r).map(radarCard),
    feed,
    mcpTools: 8,
  };
  return (
    <>
      <section className="hero">
        <Link className="badge" href="/lab">
          <b>New</b> Try to rob it: {stats.attacks} live attacks in the attack lab
        </Link>
        <h1>
          How far does your key <span className="hl">reach</span> right now?
        </h1>
        <p className="lede">
          On QoreChain a stolen classical key can only do what your post-quantum key has left open. Fenestella shows
          you that opening, cuts it down to the contracts, amount and time you need, and gives dApps and agents one way
          to ask for it.
        </p>
        <Lookup />
        <p className="faint">Reading an account needs no wallet and no gas. Works on testnet and mainnet.</p>
        <a className="btn ghost small" href="https://x.com/RaphElevator/status/2122256610231763453" target="_blank" rel="noreferrer">
          ▶ Watch the 2:55 demo
        </a>
      </section>

      <Reveal as="section" className="section" aria-labelledby="live-h">
        <div className="section-head">
          <span className="eyebrow">Live, not a mock-up</span>
          <h2 id="live-h">What it has proven, right now</h2>
          <p>Read from the chain and from the real test runs each time this page refreshes. Swipe, or let it play.</p>
        </div>
        <LiveShowcase data={data} />
      </Reveal>

      <Reveal as="section" className="section" aria-labelledby="states-h">
        <div className="section-head">
          <span className="eyebrow">One answer per account</span>
          <h2 id="states-h">Every account is in one of four states</h2>
          <p>
            Fenestella reads the chain and tells you which, in a sentence you can act on. If something could not be
            read, it says so instead of guessing.
          </p>
        </div>
        <div className="screens">
          {STATES.map((s) => (
            <div className="screen" data-level={s.level} key={s.level}>
              <div className="art">
                <Aperture level={s.level} size={132} />
              </div>
              <h3>{s.name}</h3>
              <p>{s.line}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal as="section" className="section" id="how" aria-labelledby="how-h">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 id="how-h">See it. Narrow it. Let apps ask for it.</h2>
        </div>
        <div className="grid-3">
          <div className="card feature">
            <span className="num">01</span>
            <h3>See the truth</h3>
            <p>
              Post-quantum key, proof of possession, encryption key, live window, linked keys and their limits, read
              straight from the chain.
            </p>
            <Link className="cta" href="/account/qor18ydtk2rx0wma4csyl9353kj0z29w645daa47z9?network=testnet">
              See a live account →
            </Link>
          </div>
          <div className="card feature">
            <span className="num">02</span>
            <h3>Open a fenestella</h3>
            <p>
              A window limited to named contracts or to plain transfers. Your wallet signs it with the hybrid
              ML-DSA-87 signature; the chain enforces every bound.
            </p>
            <a className="cta" href="https://docs.qorechain.io/developer-guide/evm-window-reference">
              How windows work →
            </a>
          </div>
          <div className="card feature">
            <span className="num">03</span>
            <h3>Let apps ask</h3>
            <p>
              One call, <code>requestWindow()</code>. The app states what it needs, you see its address and the bounds
              in plain words, and you approve in your own wallet.
            </p>
            <Link className="cta" href="/demo">
              Try the request flow →
            </Link>
          </div>
        </div>
      </Reveal>

      <Reveal as="section" className="section" aria-labelledby="proof-h">
        <div className="section-head">
          <span className="eyebrow">Checked on testnet</span>
          <h2 id="proof-h">Enforced by the chain, not by this page</h2>
          <p>
            We play the attacker ourselves, and you can too. In the <Link href="/lab">attack lab</Link> every attempt
            runs live on testnet and is refused by the chain, the vault, the seal or the AI, with a receipt when a
            transaction reached the chain.
          </p>
        </div>
        <div className="proof">
          <div>
            <div className="n">
              {stats.attacks} of {stats.attacks}
            </div>
            <div className="l">
              real attacks refused live: a stolen classical key, a stolen agent key, forged post-quantum signatures,
              phishing and prompt injection. <Link href="/lab">Run them →</Link>
            </div>
          </div>
          <div>
            <div className="n">{stats.contractTests}</div>
            <div className="l">contract tests passing, including fail-closed checks for inactive precompiles</div>
          </div>
          <div>
            <div className="n">{stats.unitTests}</div>
            <div className="l">unit tests on the exposure answer, the request checks, the AI&apos;s guard, autopay and plain-English rules</div>
          </div>
          <div>
            <div className="n">0</div>
            <div className="l">of your keys held by Fenestella. Your wallet signs everything you approve.</div>
          </div>
        </div>
      </Reveal>
    </>
  );
}
