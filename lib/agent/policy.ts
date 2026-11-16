import type { PolicyDraft } from "./ai";

/**
 * Fenestella's rules over the AI's policy draft, the same idea as the invoice
 * guard: the model reads the owner's words, these rules decide what may be
 * proposed for signing. A payee must be one Fenestella can identify, amounts
 * must be numbers within hard ceilings, and autopay cannot outrun the limits.
 * Pure, so it is unit-tested.
 */
export const POLICY_CEILING = { perPaymentQor: 5, perDayQor: 20, autopayDays: 90 } as const;

export interface PolicyProposal {
  payees: { name: string; address: string }[];
  perPaymentQor: string;
  perDayQor: string;
  autopay: { payee: string; payeeName: string; maxQor: string; days: number } | null;
  notes: string[];
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const num = (s: string) => (/^\d+(\.\d{1,6})?$/.test(s.trim()) ? Number(s) : NaN);

export function checkPolicy(draft: PolicyDraft, known: { name: string; address: string }[]): PolicyProposal {
  const notes: string[] = [...draft.not_understood.map((n) => `Not a rule the vault can enforce: ${n}`)];
  const payees: PolicyProposal["payees"] = [];
  for (const p of draft.payees) {
    const byName = known.find((k) => k.name.toLowerCase() === p.name.trim().toLowerCase());
    const addr = p.address.trim().toLowerCase();
    if (byName && (!addr || addr === byName.address.toLowerCase())) payees.push({ name: byName.name, address: byName.address.toLowerCase() });
    else if (byName) notes.push(`"${byName.name}" left out: the address given (${addr}) is not the one on record for it. A changed payment address is the classic invoice scam; approve a new address only after checking it with the payee yourself.`);
    else if (ADDR.test(addr)) payees.push({ name: p.name || addr, address: addr });
    else notes.push(`"${p.name}" left out: Fenestella cannot tell which address that is. Add its 0x address to approve it.`);
  }
  const cap = (s: string, max: number, label: string): string => {
    if (!s.trim()) return "";
    const v = num(s);
    if (!Number.isFinite(v) || v <= 0) {
      notes.push(`${label} "${s}" is not an amount; left blank.`);
      return "";
    }
    if (v > max) {
      notes.push(`${label} ${v} QOR is over Fenestella's ceiling of ${max} QOR; set to ${max}.`);
      return String(max);
    }
    return String(v);
  };
  const perPaymentQor = cap(draft.per_payment_qor, POLICY_CEILING.perPaymentQor, "Per payment");
  let perDayQor = cap(draft.per_day_qor, POLICY_CEILING.perDayQor, "Per day");
  if (perPaymentQor && perDayQor && Number(perDayQor) < Number(perPaymentQor)) {
    notes.push(`The daily limit was below the per-payment limit; raised to ${perPaymentQor} QOR so one payment fits.`);
    perDayQor = perPaymentQor;
  }
  let autopay: PolicyProposal["autopay"] = null;
  if (draft.autopay.enabled) {
    const target = payees.find((p) => p.name.toLowerCase() === draft.autopay.payee_name.trim().toLowerCase()) ?? (payees.length === 1 ? payees[0] : undefined);
    const max = cap(draft.autopay.max_per_bill_qor, POLICY_CEILING.perPaymentQor, "Autopay per bill");
    const days = Math.max(1, Math.min(POLICY_CEILING.autopayDays, Math.round(draft.autopay.days || 30)));
    if (!target) notes.push("Autopay left out: it must name one of the approved payees.");
    else if (!max) notes.push("Autopay left out: it needs an amount per bill.");
    else {
      const capped = perPaymentQor && Number(max) > Number(perPaymentQor) ? perPaymentQor : max;
      if (capped !== max) notes.push(`Autopay per bill lowered to ${capped} QOR to stay within the per-payment limit.`);
      autopay = { payee: target.address, payeeName: target.name, maxQor: capped, days };
    }
  }
  return { payees, perPaymentQor, perDayQor, autopay, notes };
}
