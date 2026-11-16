/**
 * The Q-Day radar's scan: every account on a QoreChain network, classified the
 * way Fenestella's console classifies one account (lib/exposure.ts).
 *
 *   npx tsx scripts/radar-scan.ts <out-dir> [testnet|mainnet ...] [--limit N]
 *
 * An account whose public key has never appeared on chain (it never signed)
 * cannot be attacked by recovering its key, so it is counted as "not exposed
 * yet" without further reads. Every other account gets the full read:
 * post-quantum key, EVM window, linked keys, balance.
 *
 * Only totals are published. No address is listed, so the radar never points
 * at an account an attacker should try first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readAccount } from "../lib/chain/read";
import { assessExposure, type ExposureLevel } from "../lib/exposure";
import { NETWORKS, type NetworkId } from "../lib/networks";

type Json = Record<string, unknown>;
const args = process.argv.slice(2);
const outDir = args[0] ?? "radar";
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const nets = (args.slice(1).filter((a) => a === "testnet" || a === "mainnet") as NetworkId[]);
const networks: NetworkId[] = nets.length ? nets : ["testnet", "mainnet"];
const CONCURRENCY = 8;

/**
 * The fetch the scan gives readAccount: chain-wide answers (latest block,
 * module config) are cached for 30 s instead of fetched per account, and a
 * throttled answer (429 or 5xx) is retried with backoff instead of becoming a
 * "could not read" section.
 */
const shared = new Map<string, { at: number; body: string; status: number }>();
const SHARED = /\/blocks\/latest$|\/blocks\/\d+$|\/abstractaccount\/v1\/config$/;
async function scanFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (SHARED.test(url)) {
    const hit = shared.get(url.replace(/\/blocks\/\d+$/, "/blocks/older"));
    if (hit && Date.now() - hit.at < 30_000) return new Response(hit.body, { status: hit.status });
  }
  for (let i = 0; ; i++) {
    const r = await fetch(input, init).catch(() => null);
    if (r && r.status !== 429 && r.status < 500) {
      if (SHARED.test(url)) {
        const body = await r.text();
        shared.set(url.replace(/\/blocks\/\d+$/, "/blocks/older"), { at: Date.now(), body, status: r.status });
        return new Response(body, { status: r.status });
      }
      return r;
    }
    if (i >= 5) return r ?? new Response("{}", { status: 503 });
    await new Promise((res) => setTimeout(res, 400 * 2 ** i + Math.random() * 300));
  }
}
const HISTORY_URL = (n: NetworkId) => `https://raw.githubusercontent.com/angelraph/fenestella/radar-data/radar/${n}.json`;

async function getJson(url: string, tries = 3): Promise<Json> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return (await r.json()) as Json;
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      if (i >= tries - 1) throw err;
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
}

interface Listed {
  address: string;
  exposed: boolean;
}

async function listAccounts(rest: string): Promise<Listed[]> {
  const out: Listed[] = [];
  let key = "";
  for (;;) {
    const q = `pagination.limit=1000${key ? `&pagination.key=${encodeURIComponent(key)}` : ""}`;
    const body = await getJson(`${rest}/cosmos/auth/v1beta1/accounts?${q}`);
    for (const raw of (body.accounts as Json[]) ?? []) {
      const type = String(raw["@type"] ?? "");
      if (type.includes("ModuleAccount")) continue;
      const base = ((raw.base_account as Json) ?? raw) as Json;
      const address = String(base.address ?? "");
      if (!address.startsWith("qor1")) continue;
      const exposed = base.pub_key != null || String(base.sequence ?? "0") !== "0";
      out.push({ address, exposed });
    }
    key = String(((body.pagination as Json) ?? {}).next_key ?? "");
    if (!key || key === "null") break;
  }
  return out;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function scan(network: NetworkId) {
  const t0 = Date.now();
  const rest = NETWORKS[network].rest;
  const listed = await listAccounts(rest);
  const exposed = listed.filter((a) => a.exposed).slice(0, LIMIT);
  const levels: Record<ExposureLevel, number> = { sealed: 0, scoped: 0, open: 0, takeover: 0, unknown: 0 } as Record<ExposureLevel, number>;
  let valueAtRisk = 0n;
  let valueBehindOpenWindows = 0n;
  let valueSealed = 0n;
  let pqcRegistered = 0;
  let possessionProven = 0;
  let kemKeys = 0;
  let agentAccounts = 0;
  let liveWindows = 0;
  let failed = 0;
  // A read the API throttled comes back partial, and the classifier then says
  // "unknown". Those accounts are read again, more slowly, before counting.
  const reads = new Map<string, Awaited<ReturnType<typeof readAccount>>>();
  let pending = exposed.map((a) => a.address);
  for (const [pass, conc, pauseMs] of [[1, CONCURRENCY, 0], [2, 4, 250], [3, 2, 600]] as const) {
    if (pending.length === 0) break;
    const retry: string[] = [];
    await mapLimit(pending, conc, async (addr) => {
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      try {
        const t = await readAccount(network, addr, scanFetch as never);
        if (assessExposure(t).level === "unknown" && pass < 3) retry.push(addr);
        else reads.set(addr, t);
      } catch {
        if (pass < 3) retry.push(addr);
      }
    });
    if (retry.length) console.log(`  ${network}: pass ${pass} left ${retry.length} partial reads to retry`);
    pending = retry;
  }
  await mapLimit(exposed, CONCURRENCY, async (a) => {
    try {
      const t = reads.get(a.address);
      if (!t) throw new Error("unreadable");
      const e = assessExposure(t);
      levels[e.level] = (levels[e.level] ?? 0) + 1;
      const bal = BigInt(t.balanceUqor || "0");
      if (e.level === "takeover") valueAtRisk += bal;
      if (e.level === "open") valueBehindOpenWindows += bal;
      if (e.level === "sealed") valueSealed += bal;
      if (t.pqc.registered) pqcRegistered++;
      if (t.pqc.possessionProven) possessionProven++;
      if (t.kem.found) kemKeys++;
      if (t.window?.live) liveWindows++;
      if (t.abstractAccount.authenticators.some((x) => !x.revoked)) agentAccounts++;
    } catch {
      failed++;
      levels.unknown = (levels.unknown ?? 0) + 1;
    }
  });
  const snapshot = {
    network,
    chainId: NETWORKS[network].chainId,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    accounts: listed.length,
    notExposedYet: listed.length - listed.filter((a) => a.exposed).length,
    exposed: listed.filter((a) => a.exposed).length,
    scanned: exposed.length,
    levels,
    pqcRegistered,
    possessionProven,
    kemKeys,
    liveWindows,
    agentAccounts,
    failed,
    valueAtRiskUqor: valueAtRisk.toString(),
    valueBehindOpenWindowsUqor: valueBehindOpenWindows.toString(),
    valueSealedUqor: valueSealed.toString(),
  };
  let history: unknown[] = [];
  try {
    const prev = (await getJson(HISTORY_URL(network), 1)) as { history?: unknown[] };
    history = Array.isArray(prev.history) ? prev.history : [];
  } catch {}
  history.push({ at: snapshot.scannedAt, exposed: snapshot.exposed, levels, valueAtRiskUqor: snapshot.valueAtRiskUqor });
  return { ...snapshot, history: history.slice(-240) };
}

mkdirSync(path.join(outDir, "radar"), { recursive: true });
for (const n of networks) {
  const s = await scan(n);
  writeFileSync(path.join(outDir, "radar", `${n}.json`), JSON.stringify(s, null, 2) + "\n");
  console.log(`${n}: ${s.accounts} accounts, ${s.exposed} exposed (${s.scanned} scanned in ${(s.durationMs / 1000).toFixed(0)}s): ${JSON.stringify(s.levels)}; at risk ${s.valueAtRiskUqor} uqor; ${s.failed} unreadable`);
}
