"use client";

import { useEffect, useRef, useState } from "react";

/** Slides its children in when they scroll into view. Without motion preferences or script, they simply show. */
export function Reveal({ children, className = "", as: Tag = "div", delay = 0, id, ...rest }: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
  delay?: number;
  id?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "hidden" | "shown">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) return; // already on screen: no flash
    setState("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as never}
      id={id}
      className={`reveal ${state === "hidden" ? "is-hidden" : ""} ${state === "shown" ? "is-shown" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
