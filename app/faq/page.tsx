import Link from "next/link";

export const metadata = { title: "FAQ · Fenestella" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Fenestella?",
    a: (
      <>
        A console for QoreChain accounts. It shows what a stolen classical key could still do to an account, lets the
        owner open an EVM window limited to exactly what they need, and gives dApps and agents one way to ask for such
        a window.
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
        use QoreX.
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
    q: "Is Fenestella audited?",
    a: (
      <>
        No. It is a hackathon project, open source under the MIT licence, with tests you can run yourself. Read{" "}
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
