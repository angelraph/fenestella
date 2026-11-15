import { AgentConsole } from "@/components/AgentConsole";

export const metadata = { title: "Agent · Fenestella" };

export default function AgentPage() {
  return (
    <>
      <section className="hero" style={{ paddingBottom: 18 }}>
        <span className="eyebrow">Post-quantum AI agent</span>
        <h1 style={{ maxWidth: "17ch" }}>
          An agent that can pay your bills, and <span className="hl">nothing else</span>.
        </h1>
        <p className="lede">
          The bill payer acts for your account without holding your keys. You decide what it may do, you give it
          instructions sealed with post-quantum encryption and signed with your post-quantum key, and the chain refuses
          everything outside the leash.
        </p>
      </section>
      <AgentConsole />
    </>
  );
}
