import { describe, expect, it } from "vitest";
import { activeAutopays, autopayOffMemo, autopayOnMemo, parseAutopayMemo } from "../lib/agent/autopay";
import type { DeliveredTx } from "../lib/chain/tx";

const OWNER = "qor1owner";
const PAYEE = "0x59ecafb2c1b0b18ad15e5859950453b78f3165f9";
const NOW = 1_800_000_000;
const iso = (unix: number) => new Date(unix * 1000).toISOString();

function tx(height: number, memo: string, over: Partial<DeliveredTx> & { from?: string; to?: string } = {}): DeliveredTx {
  const { from = OWNER, to = OWNER, ...rest } = over;
  return {
    hash: `H${height}`,
    height: String(height),
    code: 0,
    codespace: "",
    rawLog: "",
    memo,
    timestamp: iso(NOW - 1000 + height),
    messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: from, to_address: to }],
    events: [],
    hybrid: true,
    signers: [from],
    ...rest,
  };
}

describe("autopay memos", () => {
  it("round-trips on and off", () => {
    expect(parseAutopayMemo(autopayOnMemo(PAYEE.toUpperCase().replace("0X", "0x"), 1_000_000n, NOW + 86400))).toEqual({ on: true, payee: PAYEE, maxUqor: 1_000_000n, untilUnix: NOW + 86400 });
    expect(parseAutopayMemo(autopayOffMemo(PAYEE))).toEqual({ on: false, payee: PAYEE });
  });

  it.each(["", "fenestella-mandate:abc", "fenestella-autopay:v1:on:0x123:1:2", "fenestella-autopay:v1:on:" + PAYEE + ":0:99", "fenestella-autopay:v1:on:" + PAYEE + ":-1:99", "fenestella-autopay:v2:on:" + PAYEE + ":1:99"])(
    "rejects %s",
    (m) => expect(parseAutopayMemo(m)).toBeNull(),
  );
});

describe("activeAutopays", () => {
  it("reads a valid permission", () => {
    const a = activeAutopays([tx(10, autopayOnMemo(PAYEE, 1_000_000n, NOW + 86400))], OWNER, NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ payee: PAYEE, maxUqor: 1_000_000n, tx: "H10" });
  });

  it("the newest signal wins: off after on", () => {
    const a = activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400)), tx(11, autopayOffMemo(PAYEE))], OWNER, NOW);
    expect(a).toEqual([]);
  });

  it("the newest signal wins: on after off, whatever order the list comes in", () => {
    const a = activeAutopays([tx(12, autopayOnMemo(PAYEE, 5n, NOW + 86400)), tx(11, autopayOffMemo(PAYEE))], OWNER, NOW);
    expect(a[0].maxUqor).toBe(5n);
  });

  it("ignores an expired permission", () => {
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW - 1))], OWNER, NOW)).toEqual([]);
  });

  it("ignores a permission longer than 90 days", () => {
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 120 * 86400))], OWNER, NOW)).toEqual([]);
  });

  it("ignores a transaction without a post-quantum signature", () => {
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400), { hybrid: false })], OWNER, NOW)).toEqual([]);
  });

  it("ignores a send from someone else, or to someone else", () => {
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400), { from: "qor1thief" })], OWNER, NOW)).toEqual([]);
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400), { to: "qor1thief" })], OWNER, NOW)).toEqual([]);
  });

  it("ignores a failed transaction", () => {
    expect(activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400), { code: 5 })], OWNER, NOW)).toEqual([]);
  });

  it("a failed 'off' does not cancel a valid 'on'", () => {
    const a = activeAutopays([tx(10, autopayOnMemo(PAYEE, 1n, NOW + 86400)), tx(11, autopayOffMemo(PAYEE), { code: 5 })], OWNER, NOW);
    expect(a).toHaveLength(1);
  });
});
