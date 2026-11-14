import type { ExposureLevel } from "@/lib/exposure";

const COLORS: Record<ExposureLevel, string> = {
  sealed: "#7fb58a",
  scoped: "#f2b84b",
  open: "#e8804a",
  takeover: "#e2574c",
  unknown: "#8fa3b8",
};

/** Opening width, out of a 140-wide wall. */
const WIDTH: Record<ExposureLevel, number> = { sealed: 0, scoped: 16, open: 64, takeover: 140, unknown: 0 };

/**
 * The account drawn as a wall with one opening. The width of the opening is
 * the exposure: shut, a slit, a doorway, or no wall left.
 */
export function Aperture({ level, size = 160 }: { level: ExposureLevel; size?: number }) {
  const color = COLORS[level];
  const w = WIDTH[level];
  const left = 80 - w / 2;
  const stones: { x: number; y: number; w: number }[] = [];
  for (let row = 0; row < 7; row++) {
    const y = 12 + row * 20;
    const offset = row % 2 === 0 ? 0 : 18;
    for (let x = 10 - offset; x < 150; x += 36) {
      stones.push({ x: Math.max(10, x), y, w: Math.min(34, 150 - Math.max(10, x), x + 34 - 10) });
    }
  }
  const label =
    level === "sealed"
      ? "Wall with no opening"
      : level === "scoped"
        ? "Wall with a narrow slit"
        : level === "open"
          ? "Wall with a wide opening"
          : level === "takeover"
            ? "No wall left"
            : "Wall, state not known";

  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`glow-${level}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.95" />
          <stop offset="1" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
        <clipPath id="wall-clip">
          <rect x="10" y="10" width="140" height="140" rx="8" />
        </clipPath>
      </defs>
      <rect x="10" y="10" width="140" height="140" rx="8" fill="#0d0b0a" />
      {level !== "takeover" && (
        <g clipPath="url(#wall-clip)">
          {stones.map((s, i) => (
            <rect key={i} x={s.x} y={s.y} width={Math.max(0, s.w)} height={18} rx={2} fill="#2b2520" stroke="#3a332b" strokeWidth="0.6" />
          ))}
        </g>
      )}
      {w > 0 && level !== "takeover" && (
        <g>
          <path
            d={`M ${left} 150 V ${52 + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${left + w} ${52 + w / 2} V 150 Z`}
            fill={`url(#glow-${level})`}
          />
          <path
            d={`M ${left} 150 V ${52 + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${left + w} ${52 + w / 2} V 150`}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
          />
        </g>
      )}
      {level === "takeover" && (
        <g clipPath="url(#wall-clip)">
          <rect x="10" y="10" width="140" height="140" fill={`url(#glow-${level})`} opacity="0.55" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={14 + i * 36} y={132 - (i % 2) * 8} width={30} height={16} rx={2} fill="#2b2520" stroke="#3a332b" strokeWidth="0.6" transform={`rotate(${i % 2 ? 7 : -5} ${29 + i * 36} 140)`} />
          ))}
        </g>
      )}
      {level === "unknown" && (
        <text x="80" y="92" textAnchor="middle" fontSize="44" fill={color} fontFamily="Georgia, serif">
          ?
        </text>
      )}
      <rect x="10" y="10" width="140" height="140" rx="8" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" />
    </svg>
  );
}

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#26211c" stroke="#3a332b" />
      <path d="M13 26 V14 a3 3 0 0 1 6 0 V26 Z" fill="#f2b84b" />
    </svg>
  );
}
