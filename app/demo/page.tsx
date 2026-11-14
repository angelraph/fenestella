import { DemoDapp } from "@/components/DemoDapp";

export const metadata = { title: "For dApps · Fenestella" };

export default function DemoPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">For dApps and agents</span>
        <h1>Ask for the window you need. Nothing wider.</h1>
        <p className="lede">
          Today a QoreChain dApp has to tell its users to open an EVM window by hand, and the wallet can only make an
          unscoped one. With one call your app states its contracts, count, cap and duration; the user sees your origin
          and approves in their wallet.
        </p>
      </section>
      <DemoDapp />
    </>
  );
}
