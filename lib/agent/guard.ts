/**
 * Fenestella's rules, applied after the AI answers. The model is good at
 * reading messy invoices and spotting tricks; it is not trusted to apply the
 * consequences consistently. These rules do that, the same way every time,
 * and every correction is shown to the owner.
 *
 * The guard can only make a decision stricter (draft -> hold -> refuse), never
 * looser, and it takes the amount to pay from the chain, never from the AI.
 */

export type Decision = "draft_mandate" | "hold" | "refuse";
export type Risk = "low" | "medium" | "high";

export interface GuardedReview {
  decision: Decision;
  risk: Risk;
  matched_bill_id: string | null;
  flags: { kind: string; detail: string }[];
  max_pay_qor: string;
}

export interface ChainFacts {
  /** The owner's unpaid bills: id and amount in QOR. */
  unpaid: { id: string; amountQor: string }[];
  /** Whether the agent's key is linked to the owner's account, or null if unknown. */
  agentLinked: boolean | null;
  /** The per-payment cap the chain enforces, in QOR, or null if there is no rule. */
  capQor: string | null;
}

/** Signs of fraud: any one of them means the agent must not pay. */
const REFUSE_ON = new Set(["instruction_injection", "changed_payment_details", "urgency_pressure", "already_paid", "no_matching_bill"]);
/** Things the owner should look at before paying. */
const HOLD_ON = new Set(["amount_mismatch", "over_leash", "new_payee"]);

const ORDER: Decision[] = ["draft_mandate", "hold", "refuse"];
const RISK: Risk[] = ["low", "medium", "high"];
const stricter = (a: Decision, b: Decision) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const riskier = (a: Risk, b: Risk) => (RISK.indexOf(a) >= RISK.indexOf(b) ? a : b);

export function applyGuard<R extends GuardedReview>(review: R, facts: ChainFacts): { review: R; guard: string[] } {
  const out: R = { ...review, flags: [...review.flags] };
  const guard: string[] = [];
  const tighten = (to: Decision, risk: Risk, why: string) => {
    const next = stricter(out.decision, to);
    if (next !== out.decision) guard.push(`${why} The AI said "${label(out.decision)}"; Fenestella changed it to "${label(next)}".`);
    out.decision = next;
    out.risk = riskier(out.risk, risk);
  };

  for (const f of review.flags) {
    if (REFUSE_ON.has(f.kind)) tighten("refuse", "high", `The AI found a sign of fraud (${f.kind.replace(/_/g, " ")}).`);
    else if (HOLD_ON.has(f.kind)) tighten("hold", "medium", `The AI found something for you to check (${f.kind.replace(/_/g, " ")}).`);
  }

  const bill = out.matched_bill_id ? facts.unpaid.find((b) => b.id === out.matched_bill_id) : undefined;
  if (out.decision === "draft_mandate" && !bill) {
    out.flags.push({ kind: "no_matching_bill", detail: "The bill the AI named is not one of your unpaid bills on chain." });
    tighten("refuse", "high", "The AI named a bill that is not an unpaid bill of yours.");
  }

  if (bill) {
    if (out.decision === "draft_mandate" && Number(out.max_pay_qor) !== Number(bill.amountQor)) {
      guard.push(`The mandate cap is the bill's amount on chain, ${bill.amountQor} QOR${out.max_pay_qor ? `, not the ${out.max_pay_qor} QOR the AI wrote` : ""}.`);
    }
    out.max_pay_qor = out.decision === "draft_mandate" ? bill.amountQor : "";
    if (facts.capQor !== null && Number(bill.amountQor) > Number(facts.capQor)) {
      out.flags.push({ kind: "over_leash", detail: `The bill is ${bill.amountQor} QOR, above the ${facts.capQor} QOR per-payment cap; the chain would refuse it.` });
      tighten("hold", "medium", "The bill is above the agent's per-payment cap.");
    }
  } else {
    out.max_pay_qor = "";
  }

  if (out.decision === "draft_mandate" && facts.agentLinked === false) {
    guard.push("The agent is not linked to this account yet, so it cannot pay anything. Link it in step 1 first.");
  }
  return { review: out, guard };
}

function label(d: Decision): string {
  return d === "draft_mandate" ? "draft a mandate" : d;
}
