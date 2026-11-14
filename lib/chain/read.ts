import { bech32ToHex, hexToBech32, isValidBech32 } from "@qorechain/sdk";
import { NETWORKS, type NetworkId } from "../networks";
import type { AccountTruth, AuthenticatorTruth, KeyType, RuleTruth, TruthSection, WindowTruth } from "../truth";

type Json = Record<string, unknown>;
type FetchLike = (url: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Response>;

export class AddressError extends Error {}

/** Accepts `qor1…` or `0x…` and returns both encodings of the same 20 bytes. */
export function normalizeAddress(input: string): { cosmos: string; evm: string } {
  const s = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    return { cosmos: hexToBech32(s, "qor"), evm: toChecksumless(s) };
  }
  if (s.startsWith("qor1") && isValidBech32(s, "qor")) {
    const hex = bech32ToHex(s);
    return { cosmos: s, evm: toChecksumless(hex.startsWith("0x") ? hex : `0x${hex}`) };
  }
  throw new AddressError("Enter a QoreChain address: qor1… or 0x… (20 bytes).");
}

function toChecksumless(hex: string): string {
  return "0x" + hex.slice(2).toLowerCase();
}

const str = (v: unknown, d = "0"): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

async function getJson(fetchFn: FetchLike, url: string, timeoutMs = 12_000): Promise<{ status: number; body: Json }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const blockSecondsCache = new Map<NetworkId, { at: number; value: number }>();
const DEFAULT_BLOCK_SECONDS = 3.2;

async function readHeight(fetchFn: FetchLike, rest: string, network: NetworkId): Promise<{ height: string; blockSeconds: number }> {
  const latest = await getJson(fetchFn, `${rest}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const header = ((latest.body.block as Json | undefined)?.header ?? {}) as Json;
  const height = str(header.height, "");
  if (latest.status !== 200 || !/^\d+$/.test(height)) throw new Error("height unreadable");

  const cached = blockSecondsCache.get(network);
  if (cached && Date.now() - cached.at < 10 * 60_000) return { height, blockSeconds: cached.value };

  let blockSeconds = DEFAULT_BLOCK_SECONDS;
  const span = 200n;
  if (BigInt(height) > span) {
    try {
      const older = await getJson(fetchFn, `${rest}/cosmos/base/tendermint/v1beta1/blocks/${BigInt(height) - span}`);
      const t1 = Date.parse(str(header.time, ""));
      const t0 = Date.parse(str((((older.body.block as Json | undefined)?.header ?? {}) as Json).time, ""));
      const s = (t1 - t0) / 1000 / Number(span);
      if (Number.isFinite(s) && s > 0.2 && s < 60) blockSeconds = Math.round(s * 100) / 100;
    } catch {
      /* keep the default */
    }
  }
  blockSecondsCache.set(network, { at: Date.now(), value: blockSeconds });
  return { height, blockSeconds };
}

export function parseRule(raw: unknown): RuleTruth {
  const r = (raw ?? {}) as Json;
  return {
    id: str(r.id, ""),
    enabled: r.enabled === true,
    perTxLimit: str(r.per_tx_limit),
    dailyLimit: str(r.daily_limit),
    allowedDenoms: strs(r.allowed_denoms),
    allowedEvmCalls: strs(r.allowed_evm_calls),
    denomLimits: arr(r.denom_limits).map((d) => {
      const x = d as Json;
      return { denom: str(x.denom, ""), perTxLimit: str(x.per_tx_limit), dailyLimit: str(x.daily_limit) };
    }),
  };
}

export function parseWindow(body: Json): WindowTruth | null {
  if (body.found !== true) return null;
  return {
    live: body.live === true,
    openedHeight: str(body.opened_height),
    expiryHeight: str(body.expiry_height),
    maxTxs: str(body.max_txs),
    usedTxs: str(body.used_txs),
    maxValue: str(body.max_value),
    usedValue: str(body.used_value),
    remainingBlocks: str(body.remaining_blocks),
    remainingTxs: str(body.remaining_txs),
    remainingValue: str(body.remaining_value),
    nativeOnly: body.native_only === true,
    allowedTargets: strs(body.allowed_targets),
  };
}

export function parseKeyType(pubKey: unknown): KeyType {
  if (!pubKey || typeof pubKey !== "object") return "none";
  const type = str((pubKey as Json)["@type"], "");
  if (type.includes("ethsecp256k1")) return "eth_secp256k1";
  if (type.includes("secp256k1")) return "secp256k1";
  return "other";
}

/**
 * Read one account from the chain's REST API. Every section is read on its
 * own; a section that fails lands in `unknown` and the rest still answers.
 */
export async function readAccount(
  network: NetworkId,
  addressInput: string,
  fetchFn: FetchLike = fetch as FetchLike,
): Promise<AccountTruth> {
  const net = NETWORKS[network];
  const address = normalizeAddress(addressInput);
  const rest = net.rest;
  const a = address.cosmos;
  const unknown: TruthSection[] = [];

  const truth: AccountTruth = {
    network,
    chainId: net.chainId,
    readAt: new Date().toISOString(),
    height: "0",
    blockSeconds: DEFAULT_BLOCK_SECONDS,
    address,
    exists: false,
    keyType: "none",
    sequence: "0",
    balanceUqor: "0",
    tokens: [],
    pqc: { registered: false },
    kem: { found: false },
    window: null,
    abstractAccount: { moduleEnabled: false, account: null, rules: [], authenticators: [] },
    unknown,
  };

  const section = async (name: TruthSection, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      unknown.push(name);
    }
  };

  await Promise.all([
    section("height", async () => {
      const h = await readHeight(fetchFn, rest, network);
      truth.height = h.height;
      truth.blockSeconds = h.blockSeconds;
    }),

    section("auth", async () => {
      const r = await getJson(fetchFn, `${rest}/cosmos/auth/v1beta1/accounts/${a}`);
      if (r.status === 404) return; // never seen on chain
      if (r.status !== 200) throw new Error("auth");
      let acct = (r.body.account ?? {}) as Json;
      if (acct.base_account && typeof acct.base_account === "object") acct = acct.base_account as Json;
      truth.exists = true;
      truth.keyType = parseKeyType(acct.pub_key);
      truth.sequence = str(acct.sequence);
    }),

    section("balances", async () => {
      const r = await getJson(fetchFn, `${rest}/cosmos/bank/v1beta1/balances/${a}?pagination.limit=200`);
      if (r.status !== 200) throw new Error("balances");
      for (const b of arr(r.body.balances)) {
        const x = b as Json;
        const denom = str(x.denom, "");
        const amount = str(x.amount);
        if (denom === "uqor") truth.balanceUqor = amount;
        else if (denom && amount !== "0") truth.tokens.push({ denom, amount });
      }
    }),

    section("pqc", async () => {
      const r = await getJson(fetchFn, `${rest}/qorechain/pqc/v1/account/${a}`);
      if (r.status !== 200 || typeof r.body.found !== "boolean") throw new Error("pqc");
      if (!r.body.found) return;
      const acct = (r.body.account ?? {}) as Json;
      truth.pqc = {
        registered: true,
        algorithmId: typeof acct.algorithm_id === "number" ? acct.algorithm_id : Number(str(acct.algorithm_id, "1")),
        possessionProven: typeof acct.possession_proven === "boolean" ? acct.possession_proven : undefined,
      };
    }),

    section("kem", async () => {
      const r = await getJson(fetchFn, `${rest}/qorechain/pqc/v1/kem/${a}`);
      if (r.status !== 200 || typeof r.body.found !== "boolean") throw new Error("kem");
      truth.kem = { found: r.body.found };
    }),

    section("window", async () => {
      const r = await getJson(fetchFn, `${rest}/qorechain/pqc/v1/evm_window/${a}`);
      if (r.status !== 200 || typeof r.body.found !== "boolean") throw new Error("window");
      truth.window = parseWindow(r.body);
    }),

    section("abstractAccount", async () => {
      const cfg = await getJson(fetchFn, `${rest}/qorechain/abstractaccount/v1/config`);
      if (cfg.status !== 200) throw new Error("aa config");
      truth.abstractAccount.moduleEnabled = ((cfg.body.config ?? {}) as Json).enabled === true;

      const acct = await getJson(fetchFn, `${rest}/qorechain/abstractaccount/v1/accounts/${a}`);
      if (acct.status === 404 || !acct.body.account) return; // no abstract account for this address
      if (acct.status !== 200) throw new Error("aa account");
      const ac = acct.body.account as Json;
      truth.abstractAccount.account = { type: str(ac.account_type, ""), owner: str(ac.owner, "") };

      const [rules, auths] = await Promise.all([
        getJson(fetchFn, `${rest}/qorechain/abstractaccount/v1/accounts/${a}/spending_rules`),
        getJson(fetchFn, `${rest}/qorechain/abstractaccount/v1/accounts/${a}/authenticators`),
      ]);
      if (rules.status !== 200 || auths.status !== 200) throw new Error("aa detail");
      truth.abstractAccount.rules = arr(rules.body.rules).map(parseRule);
      const ownRules = new Map<string, RuleTruth>();
      for (const ar of arr(rules.body.authenticator_rules)) {
        const x = ar as Json;
        ownRules.set(`${str(x.scheme, "")}:${str(x.pubkey_hex, "").toLowerCase()}`, parseRule(x.rule));
      }
      truth.abstractAccount.authenticators = arr(auths.body.authenticators).map((raw): AuthenticatorTruth => {
        const x = raw as Json;
        const pubkeyHex = str(x.pubkey_hex, "").toLowerCase();
        const scheme = str(x.scheme, "");
        return {
          scheme,
          pubkeyHex,
          permissions: strs(x.permissions),
          expiryUnix: str(x.expiry_unix),
          createdAtUnix: str(x.created_at_unix),
          label: str(x.label, ""),
          revoked: x.revoked === true,
          hasSpendRule: x.has_spend_rule === true,
          rule: ownRules.get(`${scheme}:${pubkeyHex}`),
        };
      });
    }),
  ]);

  return truth;
}
