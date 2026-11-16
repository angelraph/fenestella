import Link from "next/link";
import { Aperture } from "@/components/Aperture";
import { Lookup } from "@/components/Lookup";
import type { ExposureLevel } from "@/lib/exposure";

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

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="badge">
          <b>New</b> Scoped EVM windows, without the command line
        </span>
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

      <section className="section" aria-labelledby="states-h">
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
      </section>

      <section className="section" id="how" aria-labelledby="how-h">
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
      </section>

      <section className="section" aria-labelledby="proof-h">
        <div className="section-head">
          <span className="eyebrow">Checked on testnet</span>
          <h2 id="proof-h">Enforced by the chain, not by this page</h2>
          <p>
            We ran the attacker ourselves: holding only the classical key of a protected account, every attempt was
            refused by QoreChain.
          </p>
        </div>
        <div className="proof">
          <div>
            <div className="n">3 of 3</div>
            <div className="l">attacks with the classical key alone refused: native send, open window, EVM send</div>
          </div>
          <div>
            <div className="n">20</div>
            <div className="l">contract tests passing, including fail-closed checks for inactive precompiles</div>
          </div>
          <div>
            <div className="n">43</div>
            <div className="l">unit tests on the exposure answer and the request checks</div>
          </div>
          <div>
            <div className="n">0</div>
            <div className="l">keys held by Fenestella. Your wallet signs every transaction.</div>
          </div>
        </div>
      </section>
    </>
  );
}
