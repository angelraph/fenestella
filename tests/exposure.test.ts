import { describe, expect, it } from "vitest";
import { assessExposure, assessLinkedKey } from "@/lib/exposure";
import type { AccountTruth, AuthenticatorTruth, RuleTruth, WindowTruth } from "@/lib/truth";

const NOW = 1_800_000_000;

function truth(over: Partial<AccountTruth> = {}): AccountTruth {
  return {
    network: "testnet",
    chainId: "qorechain-diana",
    readAt: "2026-11-14T00:00:00.000Z",
    height: "10000000",
    blockSeconds: 3,
    address: { cosmos: "qor1test", evm: "0x" + "ab".repeat(20) },
    exists: true,
    keyType: "eth_secp256k1",
    sequence: "3",
    balanceUqor: "100000000",
    tokens: [],
    pqc: { registered: true, algorithmId: 1, possessionProven: true },
    kem: { found: false },
    window: null,
    abstractAccount: { moduleEnabled: true, account: null, rules: [], authenticators: [] },
    unknown: [],
    ...over,
  };
}

function win(over: Partial<WindowTruth> = {}): WindowTruth {
  return {
    live: true,
    openedHeight: "9999000",
    expiryHeight: "10001200",
    maxTxs: "20",
    usedTxs: "0",
    maxValue: "5000000",
    usedValue: "0",
    remainingBlocks: "1200",
    remainingTxs: "20",
    remainingValue: "5000000",
    nativeOnly: false,
    allowedTargets: [],
    ...over,
  };
}

const rule = (over: Partial<RuleTruth> = {}): RuleTruth => ({
  id: "agent",
  enabled: true,
  perTxLimit: "1000000",
  dailyLimit: "5000000",
  allowedDenoms: ["uqor"],
  allowedEvmCalls: [],
  denomLimits: [],
  ...over,
});

const key = (over: Partial<AuthenticatorTruth> = {}): AuthenticatorTruth => ({
  scheme: "secp256k1",
  pubkeyHex: "aa".repeat(20),
  permissions: ["evm"],
  expiryUnix: String(NOW + 3600),
  createdAtUnix: String(NOW - 3600),
  label: "bill payer",
  revoked: false,
  hasSpendRule: false,
  ...over,
});

describe("assessExposure", () => {
  it("treats a missing post-quantum key as a takeover, worse than any window", () => {
    const x = assessExposure(truth({ pqc: { registered: false } }), NOW);
    expect(x.level).toBe("takeover");
    expect(x.headline).toMatch(/register their own post-quantum key/);
    expect(x.advice.map((a) => a.action)).toContain("register-key");
  });

  it("says the classical key becomes public with the first transaction for an account that never signed", () => {
    const x = assessExposure(truth({ pqc: { registered: false }, keyType: "none", exists: false }), NOW);
    expect(x.level).toBe("takeover");
    expect(x.warnings.join(" ")).toMatch(/not signed anything yet/);
  });

  it("is sealed when a key is registered and no window was ever opened", () => {
    const x = assessExposure(truth(), NOW);
    expect(x.level).toBe("sealed");
    expect(x.can).toEqual([]);
    expect(x.headline).toMatch(/^Nothing\./);
  });

  it("is sealed when the stored window is expired or used up", () => {
    const x = assessExposure(truth({ window: win({ live: false, remainingTxs: "0", remainingBlocks: "0" }) }), NOW);
    expect(x.level).toBe("sealed");
  });

  it("is open for a live window with no scope, and warns about approvals", () => {
    const x = assessExposure(truth({ window: win() }), NOW);
    expect(x.level).toBe("open");
    expect(x.headline).toMatch(/any contract/);
    expect(x.headline).toMatch(/5 QOR/);
    expect(x.headline).toMatch(/20 transactions/);
    expect(x.warnings.join(" ")).toMatch(/approval .* stays in force after the window closes/);
    expect(x.advice.map((a) => a.action)).toEqual(expect.arrayContaining(["narrow-window", "close-window"]));
  });

  it("caps what is reachable at the balance when the window allows more", () => {
    const x = assessExposure(truth({ balanceUqor: "1500000", window: win() }), NOW);
    expect(x.headline).toMatch(/1\.5 QOR/);
    expect(x.can[0]).toMatch(/window allows 5 QOR; the account holds less/);
  });

  it("does not assume a balance it could not read", () => {
    const x = assessExposure(truth({ balanceUqor: "0", unknown: ["balances"], window: win() }), NOW);
    expect(x.headline).toMatch(/5 QOR/);
  });

  it("is scoped for a targets window and warns that tokens are not capped", () => {
    const target = "0x" + "11".repeat(20);
    const x = assessExposure(truth({ window: win({ allowedTargets: [target] }) }), NOW);
    expect(x.level).toBe("scoped");
    expect(x.headline).toMatch(/one named contract/);
    expect(x.can[0]).toContain(target);
    expect(x.warnings.join(" ")).toMatch(/counts native QOR only/);
    expect(x.cannot.join(" ")).toMatch(/any other address/);
  });

  it("is scoped for a native-only window and says no contract can be called", () => {
    const x = assessExposure(truth({ window: win({ nativeOnly: true }) }), NOW);
    expect(x.level).toBe("scoped");
    expect(x.headline).toMatch(/plain transfers/);
    expect(x.cannot.join(" ")).toMatch(/native-only/);
  });

  it("says a window on a coin-118 account does nothing", () => {
    const x = assessExposure(truth({ keyType: "secp256k1", window: win() }), NOW);
    expect(x.level).toBe("sealed");
    expect(x.warnings.join(" ")).toMatch(/coin-118/);
    expect(x.advice.map((a) => a.action)).toEqual(expect.arrayContaining(["close-window", "use-coin60"]));
  });

  it("never reads an unreadable key status as safe", () => {
    const x = assessExposure(truth({ unknown: ["pqc"] }), NOW);
    expect(x.level).toBe("unknown");
  });

  it("never reads an unreadable window as closed", () => {
    const x = assessExposure(truth({ unknown: ["window"] }), NOW);
    expect(x.level).toBe("unknown");
    expect(x.cannot.length).toBeGreaterThan(0);
  });

  it("flags a key registered without proof of possession", () => {
    const x = assessExposure(truth({ pqc: { registered: true, possessionProven: false } }), NOW);
    expect(x.warnings.join(" ")).toMatch(/no proof of possession/);
  });

  it("warns about an active value-moving key with no rule", () => {
    const t = truth({
      abstractAccount: { moduleEnabled: true, account: { type: "session_based", owner: "qor1test" }, rules: [], authenticators: [key()] },
    });
    const x = assessExposure(t, NOW);
    expect(x.warnings.join(" ")).toMatch(/1 linked key can move value with no spending rule/);
    expect(x.advice.map((a) => a.action)).toContain("bound-keys");
  });
});

describe("assessLinkedKey", () => {
  it("is bound by the account's first enabled rule", () => {
    const k = assessLinkedKey(key(), [rule({ id: "off", enabled: false }), rule()], NOW);
    expect(k.state).toBe("active");
    expect(k.boundBy?.id).toBe("agent");
    expect(k.summary).toMatch(/1 QOR per transaction; 5 QOR per day/);
  });

  it("prefers the key's own rule", () => {
    const k = assessLinkedKey(key({ rule: rule({ id: "own", perTxLimit: "250000" }) }), [rule()], NOW);
    expect(k.boundBy?.id).toBe("own");
  });

  it("reports expired and revoked keys as unable to act", () => {
    expect(assessLinkedKey(key({ expiryUnix: String(NOW - 1) }), [rule()], NOW).state).toBe("expired");
    const revoked = assessLinkedKey(key({ revoked: true }), [rule()], NOW);
    expect(revoked.state).toBe("revoked");
    expect(revoked.boundBy).toBeNull();
  });

  it("does not count a vote-only key as moving value", () => {
    const k = assessLinkedKey(key({ permissions: ["vote"] }), [], NOW);
    expect(k.movesValue).toBe(false);
    expect(k.summary).toMatch(/cannot move funds/);
  });
});
