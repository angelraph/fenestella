import { blocksToDuration, plural, uqorToQor } from "./format";
import { VALUE_PERMISSIONS, type AccountTruth, type AuthenticatorTruth, type RuleTruth } from "./truth";

/**
 * What could someone do with this account's classical (ECDSA) key and nothing
 * else? This is the question a quantum attacker, or anyone who steals the key
 * a browser wallet holds, gets to ask. The answer is computed only from what
 * the chain reports; nothing is assumed safe because it could not be read.
 */
export type ExposureLevel =
  /** No post-quantum key: the classical key can register one and own the account. */
  | "takeover"
  /** A live window with no scope: any contract, any recipient, up to its bounds. */
  | "open"
  /** A live window narrowed to plain transfers or to named targets. */
  | "scoped"
  /** Post-quantum key registered and no live window: the classical key alone does nothing. */
  | "sealed"
  /** A section the answer depends on could not be read. */
  | "unknown";

export type AdviceAction = "register-key" | "close-window" | "narrow-window" | "use-coin60" | "bound-keys" | "retry";

export interface LinkedKeyExposure {
  pubkeyHex: string;
  scheme: string;
  label: string;
  state: "active" | "expired" | "revoked";
  permissions: string[];
  movesValue: boolean;
  /** The rule that bounds this key: its own, or the account's first enabled one. */
  boundBy: RuleTruth | null;
  summary: string;
}

export interface Exposure {
  level: ExposureLevel;
  /** One sentence a person can act on. */
  headline: string;
  /** What the classical key alone can still do. */
  can: string[];
  /** What it cannot do, and why. */
  cannot: string[];
  warnings: string[];
  advice: { action: AdviceAction; text: string }[];
  linkedKeys: LinkedKeyExposure[];
}

const NATIVE_LOCKED =
  "Send, stake, vote or change keys on the native lane. Every native transaction needs the ML-DSA-87 signature as well.";
const WINDOW_LOCKED = "Open, widen or renew an EVM window. Only the post-quantum key can.";
const APPROVAL_NOTE =
  "A token approval made through the window stays in force after the window closes. Whoever was approved can keep spending that token until the approval is revoked.";

export function assessExposure(t: AccountTruth, nowUnix: number = Math.floor(Date.now() / 1000)): Exposure {
  const linkedKeys = t.abstractAccount.authenticators.map((a) => assessLinkedKey(a, t.abstractAccount.rules, nowUnix));
  const warnings: string[] = [];
  const advice: Exposure["advice"] = [];

  const unbounded = linkedKeys.filter((k) => k.state === "active" && k.movesValue && !k.boundBy);
  if (unbounded.length > 0) {
    warnings.push(
      `${plural(unbounded.length, "linked key")} can move value with no spending rule bounding ${unbounded.length === 1 ? "it" : "them"}.`,
    );
    advice.push({ action: "bound-keys", text: "Add a spending rule, or revoke the keys you no longer use." });
  }
  if (t.unknown.includes("abstractAccount")) {
    warnings.push("Linked keys and spending rules could not be read, so they are not counted here.");
  }

  if (t.unknown.includes("pqc")) {
    return {
      level: "unknown",
      headline: "The chain did not answer whether this account has a post-quantum key, so its exposure is not known.",
      can: [],
      cannot: [],
      warnings,
      advice: [{ action: "retry", text: "Read the account again." }],
      linkedKeys,
    };
  }

  if (!t.pqc.registered) {
    const never = !t.exists || t.keyType === "none";
    return {
      level: "takeover",
      headline:
        "Whoever holds this account's classical key can register their own post-quantum key first and take the account for good.",
      can: [
        "Register an ML-DSA-87 key of their choosing. The first registration is the one transaction the chain accepts with the classical signature alone.",
        "After that, sign everything: transfers, staking, EVM windows.",
      ],
      cannot: [
        "Send an EVM transaction right now: the EVM lane needs a registered key and an open window first.",
      ],
      warnings: [
        ...warnings,
        never
          ? "This account has not signed anything yet, so its classical public key is not on chain. It becomes public with its first transaction."
          : "The classical public key is already on chain, which is what a quantum attacker needs to recover the private key.",
      ],
      advice: [
        {
          action: "register-key",
          text: "Register your ML-DSA-87 key now, with a proof of possession. In QoreX the first send does it.",
        },
      ],
      linkedKeys,
    };
  }

  const cannot = [NATIVE_LOCKED, WINDOW_LOCKED];
  if (t.pqc.possessionProven === false) {
    warnings.push(
      "The registered post-quantum key carries no proof of possession. Rotating it once proves the account really holds it.",
    );
  }

  if (t.unknown.includes("window")) {
    return {
      level: "unknown",
      headline: "The post-quantum key is registered, but the EVM window could not be read, so the exposure is not known.",
      can: [],
      cannot,
      warnings,
      advice: [{ action: "retry", text: "Read the account again." }],
      linkedKeys,
    };
  }

  const w = t.window;
  const live = !!w && w.live;

  if (t.keyType === "secp256k1") {
    if (live) {
      warnings.push(
        "A window is open, but this is a coin-118 account and the EVM lane does not accept its key. The window does nothing.",
      );
      advice.push({ action: "close-window", text: "Close the window; it only costs you its fee." });
    }
    advice.push({
      action: "use-coin60",
      text: "To use contracts, add an Ethereum account (coin 60) in QoreX and work from that one.",
    });
    return {
      level: "sealed",
      headline:
        "Nothing. The classical key alone cannot sign a native transaction, and this account's key type cannot use the EVM lane.",
      can: [],
      cannot: [...cannot, "Send any EVM transaction: the EVM lane takes Ethereum-style keys only."],
      warnings,
      advice,
      linkedKeys,
    };
  }

  if (!live || !w) {
    return {
      level: "sealed",
      headline: "Nothing. With no open EVM window, the classical key alone cannot move anything on this account.",
      can: [],
      cannot: [...cannot, "Send any EVM transaction: there is no open window to send it through."],
      warnings,
      advice,
      linkedKeys,
    };
  }

  // A live window on an Ethereum-style account: the only thing the classical key reaches.
  const remainingValue = BigInt(w.remainingValue);
  const balance = t.unknown.includes("balances") ? null : BigInt(t.balanceUqor);
  const reachable = balance !== null && balance < remainingValue ? balance : remainingValue;
  const txs = plural(BigInt(w.remainingTxs), "transaction");
  const time = `${plural(BigInt(w.remainingBlocks), "block")} (about ${blocksToDuration(BigInt(w.remainingBlocks), t.blockSeconds)})`;
  const qor = `${uqorToQor(reachable)} QOR`;
  const capNote =
    balance !== null && balance < remainingValue
      ? ` The window allows ${uqorToQor(remainingValue)} QOR; the account holds less.`
      : "";
  const hasTokens = t.tokens.length > 0;
  const can: string[] = [];
  let level: ExposureLevel;
  let headline: string;

  if (w.nativeOnly) {
    level = "scoped";
    headline = `Send up to ${qor} in plain transfers, in ${txs}, for the next ${time}. No contract can be called.`;
    can.push(`Send plain QOR transfers to any address: up to ${qor} in total, fees included.${capNote}`);
    cannot.push("Call any contract, move any token, or approve anything: the window is native-only.");
  } else if (w.allowedTargets.length > 0) {
    level = "scoped";
    const n = w.allowedTargets.length;
    headline = `Call only ${n === 1 ? "one named contract" : `${n} named addresses`}, in ${txs}, spending up to ${qor}, for the next ${time}.`;
    can.push(
      `Send transactions only to: ${w.allowedTargets.join(", ")}. Up to ${qor} in value and fees.${capNote}`,
      "Call any function those addresses expose, with any arguments.",
    );
    cannot.push("Send to any other address, or deploy a contract.");
    warnings.push(
      "The QOR cap counts native QOR only. If a listed address is a token, or a contract that can move your tokens, the window does not cap those amounts.",
      APPROVAL_NOTE,
    );
  } else {
    level = "open";
    headline = `Call any contract and pay any address: up to ${qor}, in ${txs}, for the next ${time}.`;
    can.push(
      `Send QOR to any address and call any contract: up to ${qor} in value and fees.${capNote}`,
      hasTokens
        ? `Move or approve the ${plural(t.tokens.length, "token")} this account holds. The QOR cap does not count tokens.`
        : "Approve or move any token this account receives while the window is open. The QOR cap does not count tokens.",
      "Deploy contracts from this account.",
    );
    warnings.push(APPROVAL_NOTE);
    advice.push({
      action: "narrow-window",
      text: "Replace this window with one limited to the contracts you are actually using.",
    });
  }
  advice.push({ action: "close-window", text: "Close the window as soon as you are done. Closing takes effect in the same block." });

  return { level, headline, can, cannot, warnings, advice, linkedKeys };
}

export function assessLinkedKey(a: AuthenticatorTruth, accountRules: RuleTruth[], nowUnix: number): LinkedKeyExposure {
  const expired = BigInt(a.expiryUnix) !== 0n && BigInt(a.expiryUnix) <= BigInt(nowUnix);
  const state: LinkedKeyExposure["state"] = a.revoked ? "revoked" : expired ? "expired" : "active";
  const movesValue = a.permissions.some((p) => (VALUE_PERMISSIONS as readonly string[]).includes(p));
  const own = a.rule && a.rule.enabled ? a.rule : null;
  const boundBy = own ?? accountRules.find((r) => r.enabled) ?? null;

  let summary: string;
  if (state !== "active") {
    summary = state === "revoked" ? "Revoked. It can no longer act." : "Expired. It can no longer act.";
  } else if (!movesValue) {
    summary = `Can ${a.permissions.join(", ")} for this account. It cannot move funds.`;
  } else if (!boundBy) {
    summary = `Can ${a.permissions.join(", ")} with no spending rule. The chain now refuses such a key at execution, but it should be revoked or bounded.`;
  } else {
    summary = `Can ${a.permissions.join(", ")}, bounded by ${describeRule(boundBy)}.`;
  }
  return {
    pubkeyHex: a.pubkeyHex,
    scheme: a.scheme,
    label: a.label,
    state,
    permissions: a.permissions,
    movesValue,
    boundBy: state === "active" ? boundBy : null,
    summary,
  };
}

export function describeRule(r: RuleTruth): string {
  const parts: string[] = [];
  if (BigInt(r.perTxLimit) > 0n) parts.push(`${uqorToQor(r.perTxLimit)} QOR per transaction`);
  if (BigInt(r.dailyLimit) > 0n) parts.push(`${uqorToQor(r.dailyLimit)} QOR per day`);
  if (r.allowedDenoms.length > 0) parts.push(`only ${r.allowedDenoms.join(", ")}`);
  if (r.allowedEvmCalls.length > 0) {
    parts.push(`only ${plural(r.allowedEvmCalls.length, "allowed EVM call")}`);
  }
  return parts.length > 0 ? `rule "${r.id}" (${parts.join("; ")})` : `rule "${r.id}"`;
}
