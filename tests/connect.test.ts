import { describe, expect, it } from "vitest";
import {
  isFenestellaMessage,
  normalizeWindowSpec,
  PROTOCOL,
  requestWindow,
  validateWindowSpec,
  windowCliCommand,
  windowCovers,
  type WindowSpec,
  type WindowState,
} from "@fenestella/connect";
import { closeWindowMessage, openWindowMessage } from "@/lib/messages";
import { blocksToDuration, minutesToBlocks, qorToUqor, uqorToQor } from "@/lib/format";
import { draftFromPreset, draftToSpec, parseTargets, PRESETS } from "@/lib/presets";
import { normalizeAddress, parseKeyType, parseWindow } from "@/lib/chain/read";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const base: WindowSpec = { blocks: 600, maxTxs: 10, maxValueUqor: "2000000" };

describe("validateWindowSpec", () => {
  it("accepts the chain's bounds", () => {
    expect(validateWindowSpec(base)).toEqual([]);
    expect(validateWindowSpec({ blocks: 17_280, maxTxs: 1_000, maxValueUqor: "1" })).toEqual([]);
  });

  it("refuses values outside them", () => {
    expect(validateWindowSpec({ ...base, blocks: 17_281 })).toHaveLength(1);
    expect(validateWindowSpec({ ...base, blocks: 0 })).toHaveLength(1);
    expect(validateWindowSpec({ ...base, maxTxs: 1_001 })).toHaveLength(1);
    expect(validateWindowSpec({ ...base, maxValueUqor: "0" })).toHaveLength(1);
    expect(validateWindowSpec({ ...base, maxValueUqor: "1.5" })).toHaveLength(1);
  });

  it("refuses bad, duplicate and too many targets", () => {
    expect(validateWindowSpec({ ...base, allowedTargets: ["0x123"] })).toHaveLength(1);
    expect(validateWindowSpec({ ...base, allowedTargets: [A, A.toUpperCase().replace("0X", "0x")] })).toHaveLength(1);
    const many = Array.from({ length: 17 }, (_, i) => "0x" + i.toString(16).padStart(40, "0"));
    expect(validateWindowSpec({ ...base, allowedTargets: many })).toHaveLength(1);
  });

  it("refuses native-only together with targets", () => {
    expect(validateWindowSpec({ ...base, nativeOnly: true, allowedTargets: [A] })).toHaveLength(1);
  });

  it("refuses something that is not a spec at all", () => {
    expect(validateWindowSpec(null as unknown as WindowSpec)).toHaveLength(1);
  });
});

describe("windowCovers", () => {
  const state = (over: Partial<WindowState> = {}): WindowState => ({
    live: true,
    remainingBlocks: "500",
    remainingTxs: "10",
    remainingValue: "2000000",
    nativeOnly: false,
    allowedTargets: [A],
    ...over,
  });

  it("is true when the window gives at least what is needed", () => {
    expect(windowCovers(state(), { ...base, allowedTargets: [A] })).toBe(true);
  });
  it("is false for a closed or missing window", () => {
    expect(windowCovers(null, base)).toBe(false);
    expect(windowCovers(state({ live: false }), base)).toBe(false);
  });
  it("is false when a needed target is not listed", () => {
    expect(windowCovers(state(), { ...base, allowedTargets: [A, B] })).toBe(false);
  });
  it("is false when too few transactions or too little value remain", () => {
    expect(windowCovers(state({ remainingTxs: "9" }), { ...base, allowedTargets: [A] })).toBe(false);
    expect(windowCovers(state({ remainingValue: "1999999" }), { ...base, allowedTargets: [A] })).toBe(false);
  });
  it("does not let a native-only window stand in for contract calls", () => {
    expect(windowCovers(state({ nativeOnly: true, allowedTargets: [] }), { ...base, allowedTargets: [A] })).toBe(false);
  });
  it("does not let a targets window stand in for calls to unnamed contracts", () => {
    expect(windowCovers(state(), base)).toBe(false);
  });
});

describe("windowCliCommand", () => {
  it("writes the qorechaind command with scope flags", () => {
    expect(windowCliCommand({ ...base, allowedTargets: [A] }, "me")).toBe(
      `qorechaind tx pqc open-evm-window 600 10 2000000 --allowed-targets ${A} --from me`,
    );
    expect(windowCliCommand({ ...base, nativeOnly: true }, "me")).toContain("--native-only");
  });
});

describe("requestWindow", () => {
  it("rejects an invalid request before opening anything", async () => {
    await expect(requestWindow({ ...base, blocks: 0, reason: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(requestWindow({ ...base, reason: "  " })).rejects.toMatchObject({ code: "invalid" });
  });
  it("refuses to run outside a browser", async () => {
    await expect(requestWindow({ ...base, reason: "pay bills" })).rejects.toMatchObject({ code: "failed" });
  });
});

describe("protocol", () => {
  it("recognises only its own messages", () => {
    expect(isFenestellaMessage({ protocol: PROTOCOL, type: "ready" })).toBe(true);
    expect(isFenestellaMessage({ protocol: "other", type: "ready" })).toBe(false);
    expect(isFenestellaMessage("ready")).toBe(false);
    expect(isFenestellaMessage(null)).toBe(false);
  });
});

describe("chain messages", () => {
  const sender = "qor178jr25s2wjcrj03q5vjfsfnjukplx5cn7cg8a2";
  it("builds MsgOpenEVMWindow with the scope", () => {
    const m = openWindowMessage(sender, { ...base, allowedTargets: [A] });
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    expect(JSON.stringify(m.value, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toContain(A);
  });
  it("builds MsgCloseEVMWindow", () => {
    expect(closeWindowMessage(sender).typeUrl).toBe("/qorechain.pqc.v1.MsgCloseEVMWindow");
  });
  it("refuses to build an out-of-bounds window", () => {
    expect(() => openWindowMessage(sender, { ...base, maxTxs: 5000 })).toThrow();
  });
});

describe("format and presets", () => {
  it("converts QOR and uqor exactly", () => {
    expect(qorToUqor("1.5")).toBe(1_500_000n);
    expect(qorToUqor("0.000001")).toBe(1n);
    expect(uqorToQor("1500000")).toBe("1.5");
    expect(uqorToQor(98_207_891n)).toBe("98.207891");
    expect(() => qorToUqor("1.0000001")).toThrow();
    expect(() => qorToUqor("-1")).toThrow();
    expect(() => qorToUqor("abc")).toThrow();
  });
  it("turns minutes into blocks and back into words", () => {
    expect(minutesToBlocks(16, 3.2)).toBe(300);
    expect(blocksToDuration(300, 3.2)).toBe("16 minutes");
    expect(blocksToDuration(17_280, 3.2)).toBe("15 hours");
  });
  it("makes a valid spec from every preset once targets are given", () => {
    for (const p of PRESETS) {
      const spec = draftToSpec(draftFromPreset(p, p.scope === "targets" ? `${A}\n${B}` : ""), 3.2, qorToUqor);
      expect(validateWindowSpec(spec)).toEqual([]);
      expect(normalizeWindowSpec(spec).blocks).toBeLessThanOrEqual(17_280);
    }
  });
  it("splits targets on lines, commas and spaces", () => {
    expect(parseTargets(` ${A},\n${B}  `)).toEqual([A, B]);
  });
});

describe("chain parsing", () => {
  it("reads both encodings of one address", () => {
    const n = normalizeAddress("qor178jr25s2wjcrj03q5vjfsfnjukplx5cn7cg8a2");
    expect(n.evm).toMatch(/^0x[0-9a-f]{40}$/);
    expect(normalizeAddress(n.evm).cosmos).toBe(n.cosmos);
    expect(() => normalizeAddress("cosmos1abc")).toThrow();
    expect(() => normalizeAddress("0x1234")).toThrow();
  });
  it("tells Ethereum-style keys from Cosmos-style ones", () => {
    expect(parseKeyType({ "@type": "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey" })).toBe("eth_secp256k1");
    expect(parseKeyType({ "@type": "/cosmos.crypto.secp256k1.PubKey" })).toBe("secp256k1");
    expect(parseKeyType(null)).toBe("none");
  });
  it("parses the window route, including a spent one", () => {
    expect(parseWindow({ found: false })).toBeNull();
    const w = parseWindow({
      found: true, live: false, opened_height: "9929587", expiry_height: "9929687", max_txs: "1", used_txs: "1",
      max_value: "24750", used_value: "22500", remaining_blocks: "0", remaining_txs: "0", remaining_value: "2250",
      native_only: false, allowed_targets: [],
    });
    expect(w?.live).toBe(false);
    expect(w?.remainingValue).toBe("2250");
  });
});
