import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Logo } from "@/components/Aperture";
import { HeaderWallet } from "@/components/HeaderWallet";
import { WalletProvider } from "@/components/Wallet";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Fenestella: the small window on a QoreChain account",
  description:
    "See what a leaked key could still do to your QoreChain account, open an EVM window scoped to exactly what you need, and let dApps and agents ask for it.",
};

const REPO = "https://github.com/angelraph/fenestella";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <div className="announce">
            Built for Build Before Q-Day. Live on the QoreChain testnet, <span className="mono">qorechain-diana</span>.{" "}
            <a href={REPO}>Read the source</a>
          </div>
          <header className="site-header">
            <div className="inner">
              <Link href="/" className="brand" aria-label="Fenestella home">
                <Logo />
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/">Console</Link>
                <Link href="/#how">How it works</Link>
                <Link href="/demo">For dApps</Link>
                <a href={REPO}>GitHub</a>
              </nav>
              <HeaderWallet />
            </div>
          </header>
          <main className="shell">{children}</main>
          <footer className="site-footer">
            <div className="inner">
              <span>Fenestella holds no keys. Your wallet signs; the chain enforces.</span>
              <nav aria-label="Footer">
                <Link href="/demo">For dApps</Link>
                <a href={REPO}>GitHub</a>
                <a href="https://docs.qorechain.io/developer-guide/evm-window-reference">Window reference</a>
                <span>MIT</span>
              </nav>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
