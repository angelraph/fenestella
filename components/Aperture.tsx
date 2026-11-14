import type { ExposureLevel } from "@/lib/exposure";

const COLORS: Record<ExposureLevel, string> = {
  sealed: "#6fcfae",
  scoped: "#f0c356",
  open: "#ff8f4f",
  takeover: "#ff6161",
  unknown: "#8ea2b6",
};

/** Opening width, out of a 140-wide wall. */
const WIDTH: Record<ExposureLevel, number> = { sealed: 0, scoped: 16, open: 64, takeover: 140, unknown: 0 };

const LABEL: Record<ExposureLevel, string> = {
  sealed: "Wall with no opening",
  scoped: "Wall with a narrow slit",
  open: "Wall with a wide opening",
  takeover: "No wall left",
  unknown: "Wall, state not known",
};

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
      const sx = Math.max(10, x);
      stones.push({ x: sx, y, w: Math.min(x + 34, 150) - sx });
    }
  }
  const id = `ap-${level}`;

  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={LABEL[level]}>
      <defs>
        <linearGradient id={`${id}-glow`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.95" />
          <stop offset="1" stopColor={color} stopOpacity="0.3" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect x="10" y="10" width="140" height="140" rx="10" />
        </clipPath>
      </defs>
      <rect x="10" y="10" width="140" height="140" rx="10" fill="#030404" />
      {level !== "takeover" && (
        <g clipPath={`url(#${id}-clip)`}>
          {stones.map((s, i) => (
            <rect key={i} x={s.x} y={s.y} width={Math.max(0, s.w)} height={18} rx={2.5} fill="#171b19" stroke="#262c29" strokeWidth="0.7" />
          ))}
        </g>
      )}
      {w > 0 && level !== "takeover" && (
        <g>
          <path
            d={`M ${left} 150 V ${52 + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${left + w} ${52 + w / 2} V 150 Z`}
            fill={`url(#${id}-glow)`}
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
        <g clipPath={`url(#${id}-clip)`}>
          <rect x="10" y="10" width="140" height="140" fill={`url(#${id}-glow)`} opacity="0.5" />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={14 + i * 36}
              y={132 - (i % 2) * 8}
              width={30}
              height={16}
              rx={2.5}
              fill="#171b19"
              stroke="#262c29"
              strokeWidth="0.7"
              transform={`rotate(${i % 2 ? 7 : -5} ${29 + i * 36} 140)`}
            />
          ))}
        </g>
      )}
      {level === "sealed" && (
        <path d="M68 82 l9 9 l17 -19" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {level === "unknown" && (
        <text x="80" y="96" textAnchor="middle" fontSize="46" fill={color} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600">
          ?
        </text>
      )}
      <rect x="10" y="10" width="140" height="140" rx="10" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.2" />
    </svg>
  );
}

/** The Fenestella mark: an angular doorway with one lit pane. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d="M8 19 L30 8 L56 20 V30 L32 19 L19 25.5 V51 L8 56 Z" fill="#f3eee2" />
      <path d="M26 46.5 L33.5 43 L56 53.5 V62 Z" fill="#f3eee2" />
      <path d="M36 27 L50 33.5 V46.5 L36 40 Z" fill="#6fcfae" />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <>
      <Mark size={size} />
      <span className="wordmark">Fenestella</span>
    </>
  );
}
