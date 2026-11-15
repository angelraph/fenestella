import Link from "next/link";

export const metadata = { title: "Security · Fenestella" };

export default function SecurityPage() {
  return (
    <article className="prose">
      <span className="eyebrow">Security</span>
      <h1>What Fenestella protects, and what it does not</h1>
      <p className="lede">
        The threat is simple: someone has your account&apos;s classical (ECDSA) key and nothing else. A quantum
        computer could recover it from the public key; malware or a leaked file can do it today.
      </p>

      <h2>What stops that attacker</h2>
      <p>The chain, not this site. On QoreChain:</p>
      <ul>
        <li>Every native transaction needs the ML-DSA-87 signature as well. The classical key alone is refused.</li>
        <li>Only the post-quantum key can open, widen or renew an EVM window.</li>
        <li>An EVM transaction outside an open window, or outside its scope, is refused.</li>
      </ul>
      <p>
        We ran this ourselves on testnet. With only the classical key of a protected account, a native transfer, an
        open-window message and an EVM transfer were each refused, and the balance did not change. The script is{" "}
        <a href="https://github.com/angelraph/fenestella/blob/main/scripts/attack.ts">scripts/attack.ts</a>.
      </p>

      <h2>What an open window still allows</h2>
      <ul>
        <li>Anyone holding the classical key can use it, within its bounds, until it runs out or you close it.</li>
        <li>The cap counts native QOR only. Token amounts are not capped.</li>
        <li>A token approval made through a window stays in force after the window closes.</li>
        <li>A window with no targets reaches every contract.</li>
      </ul>
      <p>Fenestella shows these facts for your account and steers you to the narrowest window that does the job.</p>

      <h2>What Fenestella itself can and cannot do</h2>
      <table>
        <thead>
          <tr>
            <th>It can</th>
            <th>It cannot</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Read public chain data about any address</td>
            <td>See or store a private key or recovery phrase when you use QoreX</td>
          </tr>
          <tr>
            <td>Hand your wallet a message to sign</td>
            <td>Sign, broadcast or change anything without your approval in the wallet</td>
          </tr>
          <tr>
            <td>Show a dApp&apos;s request with the origin your browser reports</td>
            <td>Let the dApp choose the wording of what you approve</td>
          </tr>
        </tbody>
      </table>

      <h2>Limits you should know</h2>
      <ul>
        <li>This is a hackathon project. It has tests, and it has not had an external audit.</li>
        <li>
          A wrong answer from this site could mislead you. The exposure logic is open, unit-tested and treats anything
          it could not read as unknown, never as safe. You can check any account against the chain yourself.
        </li>
        <li>If a phishing site imitates Fenestella, your wallet&apos;s own approval screen is the last check. Read it.</li>
        <li>
          The testnet key option keeps a phrase in the tab&apos;s memory. It is for development and refuses mainnet.
        </li>
        <li>
          The contracts have no owner, no upgrade path and hold no funds. <code>FenestellaReceipts</code> never trusts{" "}
          <code>msg.sender</code>; it requires an ML-DSA-87 signature checked by the chain&apos;s precompile.
        </li>
      </ul>

      <h2>Report a problem</h2>
      <p>
        Open an issue on <a href="https://github.com/angelraph/fenestella/issues">GitHub</a>. For anything that puts
        users at risk, say only that you have a security report and ask for a private channel.
      </p>
      <p>
        More: <Link href="/faq">FAQ</Link> · <Link href="/docs">Docs</Link>
      </p>
    </article>
  );
}
