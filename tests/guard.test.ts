import { describe, expect, it } from "vitest";
import { applyGuard, type GuardedReview } from "../lib/agent/guard";

const facts = { unpaid: [{ id: "1", amountQor: "0.4" }], agentLinked: true, capQor: "1" };
const draft = (over: Partial<GuardedReview> = {}): GuardedReview => ({
  decision: "draft_mandate",
  risk: "low",
  matched_bill_id: "1",
  flags: [],
  max_pay_qor: "0.4",
  ...over,
});

describe("the guard applied after the AI", () => {
  it("leaves a clean match alone", () => {
    const { review, guard } = applyGuard(draft(), facts);
    expect(review.decision).toBe("draft_mandate");
    expect(review.risk).toBe("low");
    expect(guard).toEqual([]);
  });

  it("refuses when the AI flags prompt injection but still drafts (seen live)", () => {
    const { review, guard } = applyGuard(draft({ flags: [{ kind: "instruction_injection", detail: "x" }] }), facts);
    expect(review.decision).toBe("refuse");
    expect(review.risk).toBe("high");
    expect(review.max_pay_qor).toBe("");
    expect(guard[0]).toMatch(/instruction injection/);
  });

  it.each(["changed_payment_details", "urgency_pressure", "already_paid", "no_matching_bill"])("refuses on %s", (kind) => {
    expect(applyGuard(draft({ flags: [{ kind, detail: "x" }] }), facts).review.decision).toBe("refuse");
  });

  it.each(["amount_mismatch", "over_leash", "new_payee"])("holds on %s", (kind) => {
    const { review } = applyGuard(draft({ flags: [{ kind, detail: "x" }] }), facts);
    expect(review.decision).toBe("hold");
    expect(review.risk).toBe("medium");
  });

  it("never loosens a decision", () => {
    expect(applyGuard(draft({ decision: "refuse", risk: "high" }), facts).review.decision).toBe("refuse");
    expect(applyGuard(draft({ decision: "hold", risk: "medium" }), facts).review.decision).toBe("hold");
  });

  it("refuses a draft that names a bill that is not an unpaid bill of the owner", () => {
    const { review } = applyGuard(draft({ matched_bill_id: "7" }), facts);
    expect(review.decision).toBe("refuse");
    expect(review.flags.map((f) => f.kind)).toContain("no_matching_bill");
  });

  it("takes the amount from the chain, not from the AI", () => {
    const { review, guard } = applyGuard(draft({ max_pay_qor: "50" }), facts);
    expect(review.max_pay_qor).toBe("0.4");
    expect(guard.join(" ")).toMatch(/not the 50 QOR/);
  });

  it("holds a bill above the chain's per-payment cap", () => {
    const { review } = applyGuard(draft(), { ...facts, unpaid: [{ id: "1", amountQor: "2" }] });
    expect(review.decision).toBe("hold");
    expect(review.flags.map((f) => f.kind)).toContain("over_leash");
  });

  it("says when the agent is not linked yet", () => {
    const { guard } = applyGuard(draft(), { ...facts, agentLinked: false });
    expect(guard.join(" ")).toMatch(/not linked/);
  });
});
