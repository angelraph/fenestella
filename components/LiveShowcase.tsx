"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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

export interface FeedItem {
  kind: "paid" | "autopay" | "mcp" | "refused";
  title: string;
  detail: string;
  tx: string;
  at: string;
}

export interface ShowcaseData {
  attacks: number;
  attackGroups: { label: string; n: number }[];
  unitTests: number;
  unitByFile: { name: string; n: number }[];
  contractTests: number;
  contractBySuite: { name: string; n: number }[];
  radar: RadarCard[];
  feed: FeedItem[];
  mcpTools: number;
}

const SLIDE_MS = 6500;

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

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
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
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{ x: number; t: number } | null>(null);
  const n = slides.length;

  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (paused || reduced) return;
    const t = setTimeout(() => go(index + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, reduced, go]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div className="lv">
      <div
        className="lv-stage"
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
        onPointerUp={onPointerUp}
      >
        <div className="lv-track" style={{ transform: `translateX(-${index * 100}%)` }}>
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

      <aside className="lv-feed" aria-label="Latest on chain">
        <div className="lv-feed-head">
          <span className="lv-live" aria-hidden="true" />
          <span>Latest on testnet</span>
        </div>
        {data.feed.length === 0 ? (
          <p className="faint">The chain did not answer just now. Every receipt is also linked in the README.</p>
        ) : (
          <ol className="lv-feed-list">
            {data.feed.map((f, i) => (
              <li key={f.tx} className={`lv-feed-item k-${f.kind}`} style={{ animationDelay: `${i * 90}ms` }}>
                <span className="lv-feed-dot" aria-hidden="true" />
                <div>
                  <div className="lv-feed-title">{f.title}</div>
                  <div className="lv-feed-detail">{f.detail}</div>
                  <div className="lv-feed-meta">
                    <span suppressHydrationWarning>{ago(f.at, now)}</span> ·{" "}
                    <Link href={`/tx/${f.tx}`} className="mono">
                      {f.tx.slice(0, 8)}…
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
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
