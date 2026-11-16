import { describe, expect, it } from "vitest";
import { checkPolicy } from "../lib/agent/policy";
import type { PolicyDraft } from "../lib/agent/ai";

const KNOWN = [{ name: "Northwind Hosting", address: "0x59ecafb2c1b0b18ad15e5859950453b78f3165f9" }];
const base = (over: Partial<PolicyDraft> = {}): PolicyDraft => ({
  payees: [{ name: "Northwind Hosting", address: "" }],
  per_payment_qor: "1",
  per_day_qor: "3",
  autopay: { enabled: false, payee_name: "", max_per_bill_qor: "", days: 0 },
  not_understood: [],
  summary: "",
  ...over,
});

describe("checkPolicy", () => {
  it("passes a clean draft and resolves a known payee by name", () => {
    const p = checkPolicy(base(), KNOWN);
    expect(p.payees).toEqual([{ name: "Northwind Hosting", address: KNOWN[0].address }]);
    expect(p.perPaymentQor).toBe("1");
    expect(p.perDayQor).toBe("3");
    expect(p.notes).toEqual([]);
  });

  it("drops a payee it cannot identify instead of guessing", () => {
    const p = checkPolicy(base({ payees: [{ name: "My landlord", address: "" }] }), KNOWN);
    expect(p.payees).toEqual([]);
    expect(p.notes[0]).toMatch(/cannot tell which address/);
  });

  it("refuses a known name paired with a different address (the changed-address scam)", () => {
    const p = checkPolicy(base({ payees: [{ name: "Northwind Hosting", address: "0x000000000000000000000000000000000000dead" }] }), KNOWN);
    expect(p.payees).toEqual([]);
    expect(p.notes[0]).toMatch(/not the one on record/);
  });

  it("accepts a new payee given with an explicit address", () => {
    const p = checkPolicy(base({ payees: [{ name: "City Water", address: "0x1111111111111111111111111111111111111111" }] }), KNOWN);
    expect(p.payees).toEqual([{ name: "City Water", address: "0x1111111111111111111111111111111111111111" }]);
  });

  it("caps amounts at the ceilings and rejects non-numbers", () => {
    const p = checkPolicy(base({ per_payment_qor: "500", per_day_qor: "lots" }), KNOWN);
    expect(p.perPaymentQor).toBe("5");
    expect(p.perDayQor).toBe("");
    expect(p.notes.join(" ")).toMatch(/ceiling/);
  });

  it("raises a daily limit that is below the per-payment limit", () => {
    const p = checkPolicy(base({ per_payment_qor: "2", per_day_qor: "1" }), KNOWN);
    expect(p.perDayQor).toBe("2");
  });

  it("keeps autopay inside the per-payment limit and within 90 days", () => {
    const p = checkPolicy(base({ autopay: { enabled: true, payee_name: "Northwind Hosting", max_per_bill_qor: "4", days: 400 } }), KNOWN);
    expect(p.autopay).toEqual({ payee: KNOWN[0].address, payeeName: "Northwind Hosting", maxQor: "1", days: 90 });
  });

  it("leaves autopay out when its payee is not approved", () => {
    const p = checkPolicy(base({ payees: [], autopay: { enabled: true, payee_name: "Someone", max_per_bill_qor: "1", days: 30 } }), KNOWN);
    expect(p.autopay).toBeNull();
  });

  it("carries what the AI could not express", () => {
    const p = checkPolicy(base({ not_understood: ["only on weekdays"] }), KNOWN);
    expect(p.notes[0]).toMatch(/weekdays/);
  });
});
