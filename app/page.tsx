import { Lookup } from "@/components/Lookup";

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">QoreChain account console</span>
        <h1>How far does your key reach right now?</h1>
        <p className="lede">
          On QoreChain a stolen classical key can only do what your post-quantum key has left open. Fenestella shows
          you that opening, lets you cut it to the exact contracts, amount and time you need, and gives dApps and
          agents one way to ask for it.
        </p>
        <Lookup />
        <p className="faint">Reading an account needs no wallet and no gas. Works on testnet and mainnet.</p>
      </section>

      <section className="grid-3" aria-label="What Fenestella does">
        <div className="card">
          <h3>See the truth</h3>
          <p>
            Post-quantum key, proof of possession, encryption key, live window, linked keys and their limits. Then one
            sentence: what a leaked key could still do.
          </p>
        </div>
        <div className="card">
          <h3>Open a fenestella</h3>
          <p>
            A window limited to named contracts or to plain transfers, with a count, a cap and an expiry. The chain
            enforces it. QoreX has no screen for this yet.
          </p>
        </div>
        <div className="card">
          <h3>Let apps ask</h3>
          <p>
            <code>requestWindow()</code> from <code>@fenestella/connect</code>: a dApp or agent states what it needs,
            you see its origin and approve in your wallet. No CLI, no blank cheque.
          </p>
        </div>
      </section>
    </>
  );
}
