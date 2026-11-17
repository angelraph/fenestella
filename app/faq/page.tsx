import Link from "next/link";

export const metadata = { title: "FAQ · Fenestella" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Fenestella?",
    a: (
      <>
        A console for QoreChain accounts. It shows what a stolen classical key could still do to an account, lets the
        owner open an EVM window limited to exactly what they need, and gives dApps and agents one way to ask for such
        a window. On top of that sits an AI agent that can pay your bills without being able to rob you.
      </>
    ),
  },
  {
    q: "What is an EVM authorisation window?",
    a: (
      <>
        On QoreChain, an EVM transaction is signed by a classical (ECDSA) key. The chain admits it only if the account
        has a registered ML-DSA-87 post-quantum key and that key has opened a window: a number of blocks, a number of
        transactions and a spending cap, optionally narrowed to plain transfers or to at most 16 named addresses. When
        the window runs out, the classical key can do nothing again.
      </>
    ),
  },
  {
    q: "Does Fenestella hold my keys?",
    a: (
      <>
        No. Reading an account needs no wallet at all. To change anything, Fenestella hands your wallet a message; the
        wallet shows it, signs it and broadcasts it. Fenestella never sees a private key or a recovery phrase when you
        use QoreX. The testnet bill-paying agent and the relayer that pays its fees have keys of their own, and those
        keys can do only what your signed leash allows.
      </>
    ),
  },
  {
    q: "Is this a wallet? Do I still need QoreX?",
    a: (
      <>
        It is not a wallet and does not replace one. QoreX holds your keys and signs. Fenestella decides how far those
        keys reach and shows it to you.
      </>
    ),
  },
  {
    q: "What does “Can be taken over” mean?",
    a: (
      <>
        The account has no post-quantum key registered. The first registration is the one transaction QoreChain accepts
        with the classical signature alone, so whoever holds the classical key can register their own post-quantum key
        and lock the owner out. Registering your key is the fix; in QoreX the first send does it.
      </>
    ),
  },
  {
    q: "Does the spending cap cover my tokens?",
    a: (
      <>
        No. The cap counts native QOR only: the value sent plus the maximum fee of each transaction. If a window can
        reach a token contract, token amounts are not capped by it, and a token approval made through the window stays
        in force after the window closes. Fenestella says so wherever it applies.
      </>
    ),
  },
  {
    q: "Why does it say my account cannot use the EVM lane?",
    a: (
      <>
        QoreChain has two kinds of account key. Only Ethereum-style keys (coin type 60) can send EVM transactions. A
        default Cosmos-style account (coin type 118) cannot, so a window on it does nothing. In QoreX, add an Ethereum
        account and use that one for contracts.
      </>
    ),
  },
  {
    q: "Does it work on mainnet?",
    a: (
      <>
        Reading works on both networks. EVM windows exist on both. Linked keys with spending rules are switched on by
        governance on testnet only, and the post-quantum precompiles our contracts use are active on testnet only.
        Fenestella labels those parts as testnet only.
      </>
    ),
  },
  {
    q: "What is the “testnet key” option?",
    a: (
      <>
        A development aid. It keeps a throwaway testnet recovery phrase in the browser tab&apos;s memory and signs with
        the QoreChain SDK. It refuses mainnet, stores nothing and is gone on reload. Never paste a phrase that guards
        real funds.
      </>
    ),
  },
  {
    q: "How does a dApp ask for a window?",
    a: (
      <>
        With one call, <code>requestWindow()</code>. Fenestella opens an approval page that shows the site&apos;s
        address as your browser reports it, the site&apos;s reason, and the bounds in plain words. You approve in your
        wallet. See <Link href="/docs">the docs</Link> or <Link href="/demo">try it</Link>.
      </>
    ),
  },
  {
    q: "What can go wrong if I approve a request?",
    a: (
      <>
        A window works for anyone holding your classical key, not just for the site that asked. That is why the bounds
        matter: keep the targets named, the cap small and the time short. You can close a window at any moment and it
        takes effect in the same block.
      </>
    ),
  },
  {
    q: "What does the AI agent do, and what stops it going wrong?",
    a: (
      <>
        On testnet it pays your bills. It reads each invoice with an AI model, checks it against the chain and refuses
        phishing and prompt injection. But the AI is a guard, not the wall: its key can call one function of your vault,
        the vault pays only payees you approved within your limits, and only your post-quantum signature changes those.
        You can let it pay by itself (autopay), type your rules in plain English, and read the reports it sends you,
        signed with its own post-quantum key and sealed so only you can open them. <Link href="/agent">Try it</Link>.
      </>
    ),
  },
  {
    q: "Can I try to break it?",
    a: (
      <>
        Yes. The <Link href="/lab">attack lab</Link> runs 13 real attacks on testnet when you press the button: a stolen
        classical key, a stolen agent key, forged post-quantum signatures, a tampered mandate, a replayed bill, phishing
        and prompt injection. Each one names the layer that stopped it.
      </>
    ),
  },
  {
    q: "How much of QoreChain is ready for Q-Day?",
    a: (
      <>
        The <Link href="/radar">Q-Day radar</Link> reads every account on mainnet and testnet every six hours and
        shows the totals: how many are sealed, how many have a window open, and how many could be taken over today. It
        never shows an address. If yours needs a fix, the page offers the one that seals it.
      </>
    ),
  },
  {
    q: "Can I run the agent myself, from Claude or another AI app?",
    a: (
      <>
        Yes. The Fenestella MCP server gives any app that speaks MCP the same agent on the same leash, with its key on
        your own machine. See <Link href="/docs#mcp">the docs</Link>.
      </>
    ),
  },
  {
    q: "Is Fenestella audited?",
    a: (
      <>
        Not by a human firm. Its contracts went through two QoreChain AI audits, and every finding is answered in the
        repository&apos;s AUDIT.md. The findings that held up were fixed, and the vault was redeployed after the second. It is open source under the
        MIT licence, with 49 contract tests and 86 unit tests you can run yourself. Read{" "}
        <Link href="/security">the security page</Link> for what it does and does not protect.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <article className="prose">
      <span className="eyebrow">FAQ</span>
      <h1>Questions people ask</h1>
      <div className="faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </article>
  );
}
