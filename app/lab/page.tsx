import { AttackLab } from "@/components/AttackLab";

export const metadata = { title: "Attack lab · Fenestella" };

export default function LabPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Attack lab · live on testnet</span>
        <h1 style={{ maxWidth: "17ch" }}>
          Try to rob it. <span className="hl">Watch what stops you.</span>
        </h1>
        <p className="lede">
          Thirteen real attacks: a stolen classical key, a stolen agent key, forged post-quantum signatures, tampered
          sealed mandates, phishing and prompt injection against the AI. Each one runs now, against real accounts, and
          tells you which layer refused it, with a receipt when a transaction reached the chain.
        </p>
      </section>
      <AttackLab />
    </>
  );
}
