import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/Aperture";
import { WalletProvider } from "@/components/Wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fenestella: the small window on a QoreChain account",
  description:
    "See what a leaked key could still do to your QoreChain account, open an EVM window scoped to exactly what you need, and let dApps and agents ask for it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <div className="shell">
            <header className="site-header">
              <Link href="/" className="brand">
                <Mark />
                Fenestella
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">Console</Link>
                <Link href="/demo">For dApps</Link>
                <a href="https://github.com/angelraph/fenestella">Source</a>
              </nav>
            </header>
            <main>{children}</main>
            <footer className="site-footer">
              <span>Fenestella holds no keys. QoreX signs; the chain enforces.</span>
              <span>MIT licensed. Built for Build Before Q-Day on qorechain-diana.</span>
            </footer>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
