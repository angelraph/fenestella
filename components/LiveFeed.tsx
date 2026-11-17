"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface FeedItem {
  kind: "paid" | "autopay" | "mcp" | "refused";
  title: string;
  detail: string;
  tx: string;
  at: string;
}

const POLL_MS = 45_000;
const STEP_MS = 520;

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Types `text` out once `start` is true. Screen readers get the whole text at once. */
function Typed({ text, start, speed = 16 }: { text: string; start: boolean; speed?: number }) {
  // Full text until asked to type, so the page reads the same without script.
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (!start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, start, speed]);
  const done = n >= text.length;
  return (
    <span aria-label={text}>
      <span aria-hidden="true">{text.slice(0, n)}</span>
      {start && !done && <span className="lf-caret" aria-hidden="true" />}
    </span>
  );
}

/**
 * The newest agent payments and refused attacks, as the chain recorded them.
 * Entries drop in one by one when the feed scrolls into view; new ones from
 * the chain drop in at the top as they happen. Nothing here is invented: every
 * entry links to its transaction.
 */
export function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState(initial);
  // -1: not running in a browser yet, so everything shows as is.
  const [shown, setShown] = useState(-1);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [checked, setChecked] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const itemsRef = useRef(initial);

  // Start dropping entries in once the feed is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(initial.length);
      return;
    }
    setShown(0);
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setShown((s) => Math.max(s, 1));
        io.disconnect();
      }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [initial.length]);

  useEffect(() => {
    if (shown <= 0 || shown >= items.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, items.length]);

  // Ask the chain again now and then; anything new drops in at the top.
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        if (!r.ok) return;
        const next = ((await r.json()) as { items: FeedItem[] }).items;
        setChecked(Date.now());
        const cur = itemsRef.current;
        const known = new Set(cur.map((c) => c.tx));
        const added = next.filter((x) => !known.has(x.tx));
        if (added.length === 0) return;
        const merged = [...added, ...cur].slice(0, 10);
        itemsRef.current = merged;
        setFresh(new Set(added.map((a) => a.tx)));
        setShown((s) => Math.min(merged.length, Math.max(s, 0) + added.length));
        setItems(merged);
      } catch {
        // The next poll tries again; the entries already shown stay true.
      }
    };
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="lv-feed" aria-label="Latest on testnet" ref={ref}>
      <div className="lv-feed-head">
        <span className="lv-live" aria-hidden="true" />
        <span>Latest on testnet</span>
        <span className="lf-sub" suppressHydrationWarning>
          {checked ? `checked ${ago(new Date(checked).toISOString(), now)}` : "read from the chain"}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="faint">The chain did not answer just now. Every receipt is also linked in the README.</p>
      ) : (
        <ol className="lv-feed-list" aria-live="polite">
          {items.slice(0, shown < 0 ? items.length : shown).map((f, i) => (
            <li key={f.tx} className={`lv-feed-item k-${f.kind} ${fresh.has(f.tx) ? "is-fresh" : ""}`}>
              <span className="lv-feed-dot" aria-hidden="true" />
              <div>
                <div className="lv-feed-title">
                  <Typed text={f.title} start={shown >= 0 && i < shown} />
                </div>
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
      <Link className="lf-all" href="/lab#log">
        Every attempt, on the record →
      </Link>
    </aside>
  );
}
