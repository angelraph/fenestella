"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveFeed, type FeedItem } from "./LiveFeed";

export interface RadarCard {
  network: "mainnet" | "testnet";
  scannedAt: string;
  takeover: number;
  atRiskQor: string;
  sealed: number;
  sealedQor: string;
  windows: number;
  exposed: number;
}

export type { FeedItem };

export interface ShowcaseData {
  attacks: number;
  attackGroups: { label: string; n: number }[];
  unitTests: number;
  unitByFile: { name: string; n: number }[];
  contractTests: number;
  browserTests: number;
  invariants: number;
  contractBySuite: { name: string; n: number }[];
  radar: RadarCard[];
  feed: FeedItem[];
  mcpTools: number;
}

const SLIDE_MS = 4200;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Counts up to `to` whenever `run` turns true. */
function CountUp({ to, run, decimals = 0, ms = 1100 }: { to: number; run: boolean; decimals?: number; ms?: number }) {
  const reduced = usePrefersReducedMotion();
  const [v, setV] = useState(to);
  useEffect(() => {
    if (!run || reduced) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setV(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run, ms, reduced]);
  return <>{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

function Bars({ items, run }: { items: { name: string; n: number }[]; run: boolean }) {
  const max = Math.max(...items.map((i) => i.n), 1);
  return (
    <ul className="lv-bars">
      {items.map((i, k) => (
        <li key={i.name}>
          <span className="lv-bar-name">{i.name}</span>
          <span className="lv-bar-track">
            <span className="lv-bar-fill" style={{ width: run ? `${(100 * i.n) / max}%` : "0%", transitionDelay: `${k * 70}ms` }} />
          </span>
          <span className="lv-bar-n">{i.n}</span>
        </li>
      ))}
    </ul>
  );
}

export function LiveShowcase({ data }: { data: ShowcaseData }) {
  const reduced = usePrefersReducedMotion();
  const slides = buildSlides(data);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const drag = useRef<{ x: number; y: number; t: number; locked: boolean | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const n = slides.length;

  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (paused || reduced || dragging) return;
    const t = setTimeout(() => go(index + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, reduced, dragging, go]);

  // The track follows the finger; a quick flick or a drag past a fifth of the width turns the page.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), locked: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.locked === null && Math.abs(mx) + Math.abs(my) > 8) {
      d.locked = Math.abs(mx) > Math.abs(my);
      if (d.locked) {
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    }
    if (d.locked) {
      const edge = (index === 0 && mx > 0) || (index === n - 1 && mx < 0);
      setDx(edge ? mx * 0.35 : mx);
    }
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.locked) return;
    const mx = e.clientX - d.x;
    const width = stageRef.current?.clientWidth ?? 600;
    const fast = Math.abs(mx) / Math.max(1, performance.now() - d.t) > 0.45;
    setDragging(false);
    setDx(0);
    if (Math.abs(mx) > width / 5 || (fast && Math.abs(mx) > 30)) go(index + (mx < 0 ? 1 : -1));
  };

  return (
    <div className="lv">
      <div
        ref={stageRef}
        className={`lv-stage ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="What Fenestella has proven, live"
        tabIndex={0}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(index + 1);
          if (e.key === "ArrowLeft") go(index - 1);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="lv-track" style={{ transform: `translateX(calc(${-index * 100}% + ${dx}px))` }}>
          {slides.map((s, i) => (
            <article
              key={s.key}
              className={`lv-slide ${i === index ? "is-active" : ""}`}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${s.eyebrow}`}
              aria-hidden={i !== index}
              inert={i !== index}
            >
              <span className="eyebrow">{s.eyebrow}</span>
              {s.render(i === index)}
            </article>
          ))}
        </div>
        <div className="lv-controls">
          <button className="lv-arrow" aria-label="Previous" onClick={() => go(index - 1)}>
            ←
          </button>
          <div className="lv-dots" role="tablist">
            {slides.map((s, i) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={i === index}
                aria-label={s.eyebrow}
                className={`lv-dot ${i === index ? "on" : ""} ${i === index && !paused && !reduced ? "playing" : ""}`}
                onClick={() => go(i)}
              >
                {i === index && !paused && !reduced && <span className="lv-dot-fill" style={{ animationDuration: `${SLIDE_MS}ms` }} />}
              </button>
            ))}
          </div>
          <button className="lv-arrow" aria-label="Next" onClick={() => go(index + 1)}>
            →
          </button>
        </div>
      </div>

      <LiveFeed initial={data.feed} />
    </div>
  );
}

interface Slide {
  key: string;
  eyebrow: string;
  render: (active: boolean) => React.ReactNode;
}

function buildSlides(d: ShowcaseData): Slide[] {
  const slides: Slide[] = [
    {
      key: "lab",
      eyebrow: "Attack lab · live on testnet",
      render: (on) => (
        <>
          <div className="lv-big">
            <CountUp to={d.attacks} run={on} /> <span>of {d.attacks} refused</span>
          </div>
          <p className="lv-copy">Real attacks you can run yourself. Each one names the layer that stopped it.</p>
          <ul className="lv-chips">
            {d.attackGroups.map((g, i) => (
              <li key={g.label} style={{ transitionDelay: `${i * 80}ms` }}>
                {g.label} <b>{g.n}</b>
              </li>
            ))}
          </ul>
          <Link className="btn accent small" href="/lab">
            Try to rob it →
          </Link>
        </>
      ),
    },
    {
      key: "leash",
      eyebrow: "How the agent is kept honest",
      render: () => (
        <>
          <ol className="lv-flow">
            <li>
              <span>
                <b>The AI</b> reads the invoice and checks the chain. It refuses phishing and prompt injection.
              </span>
            </li>
            <li>
              <span>
                <b>The chain</b> lets the agent&apos;s key call one function, <code>payBill</code>, and move at most
                0.000001 QOR of your own balance.
              </span>
            </li>
            <li>
              <span>
                <b>The vault</b> pays only payees you approved with your post-quantum key, within your limits.
              </span>
            </li>
          </ol>
          <p className="lv-copy">The AI can be fooled. The two layers after it cannot.</p>
          <Link className="btn ghost small" href="/agent">
            Watch the AI catch a scam →
          </Link>
        </>
      ),
    },
    ...d.radar.map(
      (r): Slide => ({
        key: `radar-${r.network}`,
        eyebrow: `Q-Day radar · ${r.network === "mainnet" ? "Mainnet" : "Testnet"}`,
        render: (on) => (
          <>
            <div className="lv-split">
              <div>
                <div className="lv-big danger">
                  <CountUp to={r.takeover} run={on} />
                </div>
                <p className="lv-copy">accounts a quantum attacker could take today, holding {r.atRiskQor} QOR</p>
              </div>
              <div>
                <div className="lv-big">
                  <CountUp to={r.sealed} run={on} />
                </div>
                <p className="lv-copy">sealed: the classical key alone moves nothing ({r.sealedQor} QOR)</p>
              </div>
            </div>
            <div className="lv-meter" aria-label={`${r.sealed} of ${r.exposed} exposed accounts sealed`}>
              <span style={{ width: on ? `${(100 * r.sealed) / Math.max(r.exposed, 1)}%` : "0%" }} />
            </div>
            <p className="faint" suppressHydrationWarning>
              Every account read on {new Date(r.scannedAt).toUTCString().slice(5, 22)} UTC. Totals only, never an address.
            </p>
            <Link className="btn ghost small" href="/radar">
              Is your account one of them? →
            </Link>
          </>
        ),
      }),
    ),
    {
      key: "tests",
      eyebrow: "Tested, and counted from the real runs",
      render: (on) => (
        <>
          <div className="lv-split">
            <div>
              <div className="lv-big">
                <CountUp to={d.contractTests} run={on} />
              </div>
              <p className="lv-copy">contract tests (Foundry)</p>
              <Bars items={d.contractBySuite} run={on} />
            </div>
            <div>
              <div className="lv-big">
                <CountUp to={d.unitTests} run={on} />
              </div>
              <p className="lv-copy">unit tests (Vitest)</p>
              <Bars items={d.unitByFile} run={on} />
            </div>
          </div>
          <p className="faint">
            The invariant suite checks {d.invariants} rules after every one of thousands of random moves by an owner, a
            vendor and a thief. Plus {d.browserTests} browser tests that drive the site against the live testnet, phone
            screens included. A check on every push fails if any number here drifts from the real runs.
          </p>
        </>
      ),
    },
    {
      key: "mcp",
      eyebrow: "Your own agent, from Claude or any MCP app",
      render: () => (
        <>
          <pre className="lv-code">npx -y @fenestella/mcp</pre>
          <p className="lv-copy">
            {d.mcpTools} tools: check any account, read the radar and your vault, ask you for a scoped window, and pay your
            approved bills. Its key stays on your machine; the chain still refuses everything else.
          </p>
          <Link className="btn ghost small" href="/docs#mcp">
            Set it up →
          </Link>
        </>
      ),
    },
  ];
  return slides;
}
