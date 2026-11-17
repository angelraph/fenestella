import Link from "next/link";
import stats from "@/lib/generated/stats.json";

export const metadata = { title: "Security · Fenestella" };

const CAN_CANNOT: { can: string; cannot: string }[] = [
  { can: "Read public chain data about any address", cannot: "See or store a private key or recovery phrase when you use QoreX" },
  { can: "Hand your wallet a message to sign", cannot: "Sign, broadcast or change anything without your approval in the wallet" },
  { can: "Show a dApp's request with the origin your browser reports", cannot: "Let the dApp choose the wording of what you approve" },
  {
    can: "Run a testnet agent and a relayer, with their own throwaway keys",
    cannot: "Move your money outside the leash you signed: one vault function, approved payees, your limits",
  },
];

export default function SecurityPage() {
  return (
    <article className="sec">
      <header className="sec-hero">
        <span className="eyebrow">Security</span>
        <h1>What Fenestella protects, and what it does not</h1>
        <p className="lede">
          The threat is simple: someone has your account&apos;s classical (ECDSA) key and nothing else. A quantum
          computer could recover it from the public key; malware or a leaked file can do it today.
        </p>
        <nav className="sec-toc" aria-label="On this page">
          <a href="#attacker">The attacker</a>
          <a href="#agent">A stolen agent key</a>
          <a href="#window">Open windows</a>
          <a href="#fenestella">Fenestella itself</a>
          <a href="#limits">Limits</a>
          <a href="#report">Report</a>
        </nav>
      </header>

      <section className="sec-card" id="attacker">
        <span className="sec-tag ok">Enforced by the chain</span>
        <h2>What stops that attacker</h2>
        <p>The chain, not this site. On QoreChain:</p>
        <ul className="sec-list ok">
          <li>Every native transaction needs the ML-DSA-87 signature as well. The classical key alone is refused.</li>
          <li>Only the post-quantum key can open, widen or renew an EVM window.</li>
          <li>An EVM transaction outside an open window, or outside its scope, is refused.</li>
        </ul>
        <p className="sec-note">
          We ran this ourselves on testnet. With only the classical key of a protected account, a native transfer, an
          open-window message and an EVM transfer were each refused, and the balance did not change. You can run those
          three, and {stats.attacks - 3} more against the agent, the vault, the seal and the AI, in the{" "}
          <Link href="/lab">attack lab</Link>.
        </p>
      </section>

      <section className="sec-card" id="agent">
        <span className="sec-tag ok">Three layers</span>
        <h2>What stops a stolen agent key</h2>
        <ol className="sec-steps">
          <li>
            <b>The chain.</b> The agent&apos;s key is linked to your account with a spending rule the chain enforces: it
            may call one function, <code>AgentVault.payBill</code>, and move at most 0.000001 QOR of your own balance.
          </li>
          <li>
            <b>The vault.</b> It pays only payees you approved, within limits you set, from the budget you put in. Only
            your ML-DSA-87 signature, checked on chain by <code>pqcVerify</code>, changes payees or limits, pauses the
            vault or withdraws.
          </li>
          <li>
            <b>The AI.</b> It reviews every bill, but it never has the last word. A guard written in code can only make
            its answer stricter, and the chain and the vault come after both.
          </li>
        </ol>
      </section>

      <section className="sec-card warn" id="window">
        <span className="sec-tag warn">Know this before you approve</span>
        <h2>What an open window still allows</h2>
        <ul className="sec-list warn">
          <li>Anyone holding the classical key can use it, within its bounds, until it runs out or you close it.</li>
          <li>The cap counts native QOR only. Token amounts are not capped.</li>
          <li>A token approval made through a window stays in force after the window closes.</li>
          <li>A window with no targets reaches every contract.</li>
        </ul>
        <p className="sec-note">Fenestella shows these facts for your account and steers you to the narrowest window that does the job.</p>
      </section>

      <section id="fenestella" className="sec-block">
        <h2>What Fenestella itself can and cannot do</h2>
        <div className="sec-two">
          <div className="sec-card">
            <span className="sec-tag ok">It can</span>
            <ul className="sec-list ok">
              {CAN_CANNOT.map((r) => (
                <li key={r.can}>{r.can}</li>
              ))}
            </ul>
          </div>
          <div className="sec-card">
            <span className="sec-tag bad">It cannot</span>
            <ul className="sec-list bad">
              {CAN_CANNOT.map((r) => (
                <li key={r.cannot}>{r.cannot}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="sec-card" id="limits">
        <span className="sec-tag">Honest limits</span>
        <h2>Limits you should know</h2>
        <ul className="sec-list">
          <li>
            This is a hackathon project. It has {stats.contractTests} contract tests and {stats.unitTests} unit tests,
            and its contracts went through two QoreChain AI audits with every finding answered in{" "}
            <a href="https://github.com/angelraph/fenestella/blob/main/AUDIT.md">AUDIT.md</a>. No human firm has audited it.
          </li>
          <li>
            The AI can be fooled, and a payee you approved can still bill you for real amounts within your limits. Approve
            only payees you trust.
          </li>
          <li>
            A wrong answer from this site could mislead you. The exposure logic is open, unit-tested and treats anything
            it could not read as unknown, never as safe. You can check any account against the chain yourself.
          </li>
          <li>If a phishing site imitates Fenestella, your wallet&apos;s own approval screen is the last check. Read it.</li>
          <li>The testnet key option keeps a phrase in the tab&apos;s memory. It is for development and refuses mainnet.</li>
          <li>
            The contracts have no admin and no upgrade path. Only <code>AgentVault</code> holds funds, each owner&apos;s
            agent budget, and only that owner&apos;s ML-DSA-87 signature can take it out. The vault&apos;s admin actions
            and <code>FenestellaReceipts</code> never trust <code>msg.sender</code>: they require a signature checked by
            the chain&apos;s precompile.
          </li>
        </ul>
      </section>

      <section className="sec-card" id="report">
        <h2>Report a problem</h2>
        <p>
          Open an issue on <a href="https://github.com/angelraph/fenestella/issues">GitHub</a>. For anything that puts
          users at risk, say only that you have a security report and ask for a private channel.
        </p>
        <p className="sec-more">
          <Link href="/lab">Attack lab</Link> · <Link href="/faq">FAQ</Link> · <Link href="/docs">Docs</Link>
        </p>
      </section>
    </article>
  );
}
