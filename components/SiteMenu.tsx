"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HeaderWallet } from "./HeaderWallet";

export const NAV: { href: string; label: string; hint: string }[] = [
  { href: "/", label: "Console", hint: "What could a leaked key do?" },
  { href: "/agent", label: "Agent", hint: "An AI that pays bills, and nothing else" },
  { href: "/lab", label: "Attack lab", hint: "Try to rob it, live" },
  { href: "/radar", label: "Radar", hint: "How ready is QoreChain for Q-Day?" },
  { href: "/demo", label: "For dApps", hint: "Ask for exactly the window you need" },
  { href: "/docs", label: "Docs", hint: "requestWindow, MCP server, API, contracts" },
  { href: "/faq", label: "FAQ", hint: "Questions people ask" },
  { href: "/security", label: "Security", hint: "What it protects, and what it does not" },
];

/** Small screens: every page and the wallet, behind one ☰ menu button at the top right. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.body.classList.add("menu-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.body.classList.remove("menu-open");
    };
  }, [open]);

  return (
    <div className="site-menu">
      <button
        ref={button}
        className={`menu-btn ${open ? "on" : ""}`}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="menu-bars">
          <i />
          <i />
          <i />
        </span>
      </button>
      <div id="site-menu-panel" ref={panel} className={`menu-panel ${open ? "open" : ""}`} hidden={!open}>
        <div className="menu-wallet">
          <HeaderWallet />
        </div>
        <nav aria-label="Pages">
          {NAV.map((n, i) => {
            const here = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={here ? "here" : ""} style={{ animationDelay: `${40 + i * 35}ms` }} aria-current={here ? "page" : undefined}>
                <span>{n.label}</span>
                <small>{n.hint}</small>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
