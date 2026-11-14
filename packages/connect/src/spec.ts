/**
 * The shape of a requested EVM authorisation window, and the checks the chain
 * applies to it. Pure: no network, no DOM, no dependencies.
 */
export const WINDOW_LIMITS = { maxBlocks: 17_280, maxTxs: 1_000, maxTargets: 16 } as const;

export type FenestellaNetwork = "testnet" | "mainnet";

export interface WindowSpec {
  /** How many blocks the window stays open: 1 to 17,280. */
  blocks: number;
  /** How many EVM transactions it admits: 1 to 1,000. */
  maxTxs: number;
  /** Total it may spend in uqor (1 QOR = 1,000,000 uqor): value plus the maximum fee of each transaction. */
  maxValueUqor: string;
  /** Only plain QOR transfers: no calldata, no contracts. Cannot be combined with `allowedTargets`. */
  nativeOnly?: boolean;
  /** Only these `0x` recipients (at most 16). Contract creation is refused. */
  allowedTargets?: string[];
}

/** What the chain reports for a stored window, as far as a caller needs it. */
export interface WindowState {
  live: boolean;
  remainingBlocks: string;
  remainingTxs: string;
  remainingValue: string;
  nativeOnly: boolean;
  allowedTargets: string[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Returns every problem with a spec; an empty list means the chain's bounds are met. */
export function validateWindowSpec(spec: WindowSpec): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object") return ["A window needs a duration, a transaction count and a spending cap."];
  if (!Number.isInteger(spec.blocks) || spec.blocks < 1 || spec.blocks > WINDOW_LIMITS.maxBlocks) {
    errors.push(`Duration must be 1 to ${WINDOW_LIMITS.maxBlocks.toLocaleString("en-US")} blocks.`);
  }
  if (!Number.isInteger(spec.maxTxs) || spec.maxTxs < 1 || spec.maxTxs > WINDOW_LIMITS.maxTxs) {
    errors.push(`Transactions must be 1 to ${WINDOW_LIMITS.maxTxs.toLocaleString("en-US")}.`);
  }
  if (typeof spec.maxValueUqor !== "string" || !/^\d+$/.test(spec.maxValueUqor) || BigInt(spec.maxValueUqor) <= 0n) {
    errors.push("The spending cap must be above zero.");
  }
  const targets = Array.isArray(spec.allowedTargets) ? spec.allowedTargets : [];
  if (targets.length > WINDOW_LIMITS.maxTargets) {
    errors.push(`At most ${WINDOW_LIMITS.maxTargets} target addresses.`);
  }
  const seen = new Set<string>();
  for (const t of targets) {
    if (typeof t !== "string" || !ADDRESS.test(t)) {
      errors.push(`Not a 0x address: ${String(t).slice(0, 48)}`);
      continue;
    }
    const k = t.toLowerCase();
    if (seen.has(k)) errors.push(`Listed twice: ${t}`);
    seen.add(k);
  }
  if (spec.nativeOnly && targets.length > 0) {
    errors.push("Choose either native-only or a list of targets, not both.");
  }
  return errors;
}

/** A copy with targets lower-cased and optional fields made explicit. Throws if the spec is not valid. */
export function normalizeWindowSpec(spec: WindowSpec): Required<WindowSpec> {
  const errors = validateWindowSpec(spec);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return {
    blocks: spec.blocks,
    maxTxs: spec.maxTxs,
    maxValueUqor: spec.maxValueUqor,
    nativeOnly: spec.nativeOnly === true,
    allowedTargets: (spec.allowedTargets ?? []).map((t) => t.toLowerCase()),
  };
}

/**
 * Does a window the chain reports give at least what `need` asks for? Use it
 * to skip a request when the user already has a suitable window, and to check
 * the result of one.
 */
export function windowCovers(state: WindowState | null | undefined, need: WindowSpec, minBlocks = 1): boolean {
  if (!state || !state.live) return false;
  const n = normalizeWindowSpec(need);
  if (BigInt(state.remainingBlocks) < BigInt(minBlocks)) return false;
  if (BigInt(state.remainingTxs) < BigInt(n.maxTxs)) return false;
  if (BigInt(state.remainingValue) < BigInt(n.maxValueUqor)) return false;
  if (n.nativeOnly) return state.nativeOnly || state.allowedTargets.length === 0;
  if (state.nativeOnly) return false;
  if (state.allowedTargets.length === 0) return true; // an unscoped window admits any target
  const have = new Set(state.allowedTargets.map((t) => t.toLowerCase()));
  return n.allowedTargets.length > 0 && n.allowedTargets.every((t) => have.has(t));
}

/** The `qorechaind` command that opens the same window, for people who prefer the CLI. */
export function windowCliCommand(spec: WindowSpec, from = "<your-key>"): string {
  const n = normalizeWindowSpec(spec);
  const flags = [
    n.nativeOnly ? "--native-only" : "",
    n.allowedTargets.length > 0 ? `--allowed-targets ${n.allowedTargets.join(",")}` : "",
    `--from ${from}`,
  ].filter(Boolean);
  return `qorechaind tx pqc open-evm-window ${n.blocks} ${n.maxTxs} ${n.maxValueUqor} ${flags.join(" ")}`;
}
