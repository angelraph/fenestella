import { AgentConsole } from "@/components/AgentConsole";

export const metadata = { title: "Agent · Fenestella" };

export default function AgentPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 18 }}>
        <span className="eyebrow">Post-quantum AI agent</span>
        <h1 style={{ maxWidth: "18ch" }}>
          An AI agent that can pay your bills, and <span className="hl">nothing else</span>.
        </h1>
        <p className="lede">
          The bill payer reads your invoices with Claude, checks them against the chain with its own tools, and spots
          scams before you sign. It acts without holding your keys, takes orders only from mandates sealed with
          post-quantum encryption and signed with your post-quantum key, and the chain refuses everything outside its
          leash. The AI can be fooled. The leash cannot.
        </p>
      </section>
      <AgentConsole />
    </>
  );
}
