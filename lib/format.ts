import { UQOR_PER_QOR } from "./networks";

/** "1500000" uqor -> "1.5". Never rounds: trailing zeros are trimmed, nothing else. */
export function uqorToQor(uqor: bigint | string): string {
  const v = typeof uqor === "bigint" ? uqor : BigInt(uqor);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / UQOR_PER_QOR;
  const frac = (abs % UQOR_PER_QOR).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** "1.5" QOR -> 1500000n uqor. Throws on anything that is not a plain decimal with at most 6 places. */
export function qorToUqor(qor: string): bigint {
  const s = qor.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    throw new Error("Enter an amount in QOR with at most 6 decimal places.");
  }
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * UQOR_PER_QOR + BigInt(frac.padEnd(6, "0"));
}

/** A block count as a rough human duration, given seconds per block. */
export function blocksToDuration(blocks: bigint | number, blockSeconds: number): string {
  const secs = Math.round(Number(blocks) * blockSeconds);
  if (secs < 90) return `${secs} seconds`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins} minutes`;
  const hours = secs / 3600;
  if (hours < 36) return `${hours.toFixed(hours < 10 ? 1 : 0).replace(/\.0$/, "")} hours`;
  return `${Math.round(hours / 24)} days`;
}

/** A duration in minutes as a block count, never below 1. */
export function minutesToBlocks(minutes: number, blockSeconds: number): number {
  return Math.max(1, Math.round((minutes * 60) / blockSeconds));
}

export function shortAddress(addr: string, head = 8, tail = 6): string {
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function plural(n: bigint | number, one: string, many = one + "s"): string {
  return `${n.toLocaleString("en-US")} ${BigInt(n) === 1n ? one : many}`;
}

export function unixToDate(unix: string | number | bigint): string {
  const d = new Date(Number(unix) * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
