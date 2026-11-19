import "server-only";
import { executionFailures, listTxsBySender } from "./chain/tx";
import { NETWORKS } from "./networks";
import { uqorToQor } from "./format";

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

export interface Attempt {
  tried: string;
  /** Who refused it; "nobody" means it went through, and the log says so. */
  by: "the chain" | "the vault" | "nobody";
  reason: string;
  tx: string;
  at: string;
}

const TRIED: Record<string, string> = {
  drain: "Drain the owner's account with the stolen agent key",
  "plain transfer": "Drain the owner's account with the stolen agent key",
  "approve itself": "Make the vault trust the attacker as a payee",
  "pay a thief": "Pay a bill the attacker posted to the owner",
};

export type HistoryKind = "link" | "revoke" | "rules" | "window" | "autopay" | "order" | "paid" | "refused" | "stop";
export interface HistoryItem {
  kind: HistoryKind;
  title: string;
  detail: string;
  tx: string;
  at: string;
  /** Who signed it: the owner, or the agent (relayed). */
  by: "you" | "agent";
}

const typeOf = (m: unknown) => String((m as Record<string, unknown>)?.["@type"] ?? "");
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

/**
 * Everything the agent did for one account, and everything the owner did to
 * it, as the chain recorded it, newest first: links, revokes, rule changes,
 * windows, standing permissions, signed orders, payments and refusals.
 */
export async function loadOwnerHistory(owner: string, limit = 40): Promise<HistoryItem[]> {
  const cachedFetch = ((url: string) => fetch(url, { next: { revalidate: 30 } })) as typeof fetch;
  const rest = NETWORKS.testnet.rest;
  const [own, relayed] = await Promise.all([
    listTxsBySender(rest, owner, 60, cachedFetch).catch(() => []),
    listTxsBySender(rest, RELAYER, 100, cachedFetch).catch(() => []),
  ]);
  const out: HistoryItem[] = [];

  for (const t of own) {
    if (t.code !== 0) continue;
    const types = t.messages.map(typeOf);
    const memo = t.memo;
    const base = { tx: t.hash, at: t.timestamp, by: "you" as const };
    let m: RegExpMatchArray | null;
    if (memo === "fenestella: stop everything") {
      out.push({ ...base, kind: "stop", title: "You stopped everything", detail: "Every linked key revoked and any open window closed, in one transaction" });
    } else if ((m = memo.match(/^fenestella-autopay:v1:on:(0x[0-9a-fA-F]{40}):(\d+):(\d+)$/))) {
      out.push({ ...base, kind: "autopay", title: "You turned autopay on", detail: `Payee ${short(m[1])}, up to ${uqorToQor(m[2])} QOR a bill, until ${new Date(Number(m[3]) * 1000).toUTCString().slice(5, 16)}` });
    } else if ((m = memo.match(/^fenestella-autopay:v1:off:(0x[0-9a-fA-F]{40})$/))) {
      out.push({ ...base, kind: "autopay", title: "You turned autopay off", detail: `Payee ${short(m[1])}` });
    } else if (memo.startsWith("fenestella-mandate:")) {
      out.push({ ...base, kind: "order", title: "You signed a payment order", detail: "Sealed to the agent; its fingerprint signed with your post-quantum key" });
    } else if (types.some((x) => x.endsWith("MsgRevokeAuthenticator")) && types.some((x) => x.endsWith("MsgRegisterAuthenticator"))) {
      out.push({ ...base, kind: "link", title: "You renewed the agent's link", detail: "Revoked and linked again in one transaction, with a fresh expiry" });
    } else if (types.some((x) => x.endsWith("MsgRevokeAuthenticator"))) {
      out.push({ ...base, kind: "revoke", title: "You revoked an agent key", detail: "From that block on, the key could not act for you" });
    } else if (types.some((x) => x.endsWith("MsgRegisterAuthenticator"))) {
      out.push({ ...base, kind: "link", title: "You linked an agent key", detail: "One permission: call AgentVault.payBill, within your spending rule" });
    } else if (types.some((x) => x.endsWith("MsgUpdateSpendingRules"))) {
      out.push({ ...base, kind: "rules", title: "You changed the leash", detail: "The account's spending rules were replaced" });
    } else if (types.some((x) => x.endsWith("MsgOpenEVMWindow"))) {
      const what = memo.replace(/^fenestella:\s*/, "");
      out.push({ ...base, kind: "window", title: "You opened a window", detail: what ? what.charAt(0).toUpperCase() + what.slice(1) : "An EVM authorisation window" });
    } else if (types.some((x) => x.endsWith("MsgCloseEVMWindow"))) {
      out.push({ ...base, kind: "window", title: "You closed the window", detail: "The classical key can do nothing on the EVM again" });
    }
  }

  for (const t of relayed) {
    const exec = t.messages.find((x) => typeOf(x).endsWith("MsgExecuteEVM")) as Record<string, unknown> | undefined;
    if (!exec || String(exec.account ?? "") !== owner) continue;
    const failed = t.code !== 0 ? t.rawLog || "refused" : executionFailures(t)[0]?.attributes.reason ?? null;
    const base = { tx: t.hash, at: t.timestamp, by: "agent" as const };
    let m: RegExpMatchArray | null;
    if ((m = t.memo.match(/stolen agent key, (.+)$/))) {
      out.push({
        ...base,
        kind: failed ? "refused" : "paid",
        title: failed ? `Refused: a stolen agent key ${ATTACK_WORDS[m[1]] ?? m[1]}` : `A stolen agent key's call went through: ${m[1]}`,
        detail: failed ? `Stopped by ${/revert/i.test(failed) ? "the vault" : "the chain"}. Nothing moved.` : "Listed as it happened.",
      });
    } else if ((m = t.memo.match(/bill (\d+)$/))) {
      const how = t.memo.includes("autopay") ? "by autopay" : t.memo.includes("own agent") ? "by your own agent (MCP)" : "on your signed order";
      out.push({
        ...base,
        kind: failed ? "refused" : "paid",
        title: failed ? `Payment of bill #${m[1]} refused` : `The agent paid bill #${m[1]}`,
        detail: failed ? clip(failed, 140) : `From your vault, ${how}`,
      });
    }
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** The chain's own words, cut at a word boundary when long. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:(]+$/, "")}…`;
}

/** Every attack attempt the relayer broadcast, newest first, with the chain's own reason for refusing it. */
export async function loadAttempts(limit = 30): Promise<Attempt[]> {
  try {
    const cachedFetch = ((url: string) => fetch(url, { next: { revalidate: REVALIDATE } })) as typeof fetch;
    const txs = await listTxsBySender(NETWORKS.testnet.rest, RELAYER, 100, cachedFetch);
    const out: Attempt[] = [];
    for (const t of txs) {
      const m = t.memo.match(/stolen agent key, (.+)$/);
      if (!m) continue;
      const failed = t.code !== 0 ? t.rawLog || `refused with code ${t.code}` : executionFailures(t)[0]?.attributes.reason;
      out.push({
        tried: TRIED[m[1]] ?? m[1],
        by: !failed ? "nobody" : /revert/i.test(failed) ? "the vault" : "the chain",
        reason: !failed
          ? "It went through."
          : /revert/i.test(failed)
            ? "The chain let the call through; the vault reverted it, so nothing moved."
            : clip(failed, 170),
        tx: t.hash,
        at: t.timestamp,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

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
