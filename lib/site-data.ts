import "server-only";
import { executionFailures, listTxsBySender } from "./chain/tx";
import { NETWORKS } from "./networks";

/**
 * Live data for the landing page, read from the chain and from the radar's
 * published scans. Cached for a couple of minutes; anything that cannot be
 * read is left out rather than guessed.
 */

/** Fenestella's relayer: it broadcasts every agent payment and every lab attack, so its history is the agent's history. */
export const RELAYER = "qor1qwa03dpa0as9kykh5mdqwqrcsf5e22lrt34rrk";
const REVALIDATE = 120;
const RADAR = (n: string) => `https://raw.githubusercontent.com/angelraph/fenestella/radar-data/radar/${n}.json`;

type Levels = { sealed: number; scoped: number; open: number; takeover: number; unknown: number };
export interface RadarTotals {
  network: "mainnet" | "testnet";
  scannedAt: string;
  exposed: number;
  accounts: number;
  levels: Levels;
  valueAtRiskUqor: string;
  valueSealedUqor: string;
}

export async function loadRadar(network: "mainnet" | "testnet"): Promise<RadarTotals | null> {
  try {
    const r = await fetch(RADAR(network), { next: { revalidate: 300 } });
    return r.ok ? ((await r.json()) as RadarTotals) : null;
  } catch {
    return null;
  }
}

export type ActivityKind = "paid" | "autopay" | "mcp" | "refused";
export interface Activity {
  kind: ActivityKind;
  title: string;
  detail: string;
  tx: string;
  at: string;
}

const ATTACK_WORDS: Record<string, string> = {
  drain: "tried to drain the account",
  "plain transfer": "tried to drain the account",
  "approve itself": "tried to approve itself as a payee",
  "pay a thief": "tried to pay a bill a thief posted",
};

/** The newest agent payments and refused attacks, as the chain recorded them. */
export async function loadActivity(limit = 10): Promise<Activity[]> {
  try {
    const cachedFetch = ((url: string) => fetch(url, { next: { revalidate: REVALIDATE } })) as typeof fetch;
    const txs = await listTxsBySender(NETWORKS.testnet.rest, RELAYER, 40, cachedFetch);
    const out: Activity[] = [];
    for (const t of txs) {
      if (t.code !== 0) continue;
      const failed = executionFailures(t)[0]?.attributes.reason ?? null;
      const memo = t.memo;
      let m: RegExpMatchArray | null;
      if ((m = memo.match(/^fenestella relay: own agent pays bill (\d+)$/)) && !failed) {
        out.push({ kind: "mcp", title: `An MCP agent paid bill #${m[1]}`, detail: "Signed on the owner's own machine, paid from the vault", tx: t.hash, at: t.timestamp });
      } else if ((m = memo.match(/^fenestella autopay: bill (\d+)$/)) && !failed) {
        out.push({ kind: "autopay", title: `Autopay paid bill #${m[1]}`, detail: "Under a standing permission the owner signed with ML-DSA-87", tx: t.hash, at: t.timestamp });
      } else if ((m = memo.match(/^fenestella agent: pay bill (\d+)$/)) && !failed) {
        out.push({ kind: "paid", title: `The agent paid bill #${m[1]}`, detail: "AI-reviewed, mandate sealed and signed by the owner", tx: t.hash, at: t.timestamp });
      } else if ((m = memo.match(/stolen agent key, (.+)$/)) && failed) {
        const by = /revert/i.test(failed) ? "the vault" : "the chain";
        // The lab runs the same attacks again and again; show each kind once, its newest run.
        if (out.some((a) => a.kind === "refused" && a.title.endsWith(ATTACK_WORDS[m![1]] ?? m![1]))) continue;
        out.push({ kind: "refused", title: `A stolen agent key ${ATTACK_WORDS[m[1]] ?? m[1]}`, detail: `Refused by ${by}. Nothing moved.`, tx: t.hash, at: t.timestamp });
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
