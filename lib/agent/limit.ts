/**
 * A small in-memory rate limit for the agent's write routes. The relayer and
 * vendor pay fees from test QOR, so each owner may trigger one write per
 * window, and the whole instance only so many per hour.
 */
const recent = new Map<string, number>();
let hourStart = Date.now();
let hourCount = 0;

export function allow(key: string, everyMs: number, perHour = 60): string | null {
  const now = Date.now();
  if (now - hourStart > 3_600_000) {
    hourStart = now;
    hourCount = 0;
  }
  if (hourCount >= perHour) return "The agent is busy. Try again in a little while.";
  const last = recent.get(key) ?? 0;
  if (now - last < everyMs) return `Please wait ${Math.ceil((everyMs - (now - last)) / 1000)} seconds before trying again.`;
  recent.set(key, now);
  hourCount += 1;
  return null;
}
