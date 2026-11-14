import type { Exposure } from "./exposure";
import type { NetworkId } from "./networks";
import type { AccountTruth } from "./truth";

export interface AccountAnswer {
  truth: AccountTruth;
  exposure: Exposure;
}

/** Read an account through this app's own API route (the chain's REST has no CORS). */
export async function fetchAccount(network: NetworkId, address: string): Promise<AccountAnswer> {
  const res = await fetch(`/api/account?network=${network}&address=${encodeURIComponent(address)}`, {
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Partial<AccountAnswer> & { error?: string };
  if (!res.ok || !body.truth || !body.exposure) {
    throw new Error(body.error ?? "The account could not be read.");
  }
  return { truth: body.truth, exposure: body.exposure };
}

/**
 * Read the account until `done` says the change has landed, or give up.
 * Returns the last answer either way so the caller can show what the chain says.
 */
export async function pollAccount(
  network: NetworkId,
  address: string,
  done: (a: AccountAnswer) => boolean,
  { tries = 12, delayMs = 1500 }: { tries?: number; delayMs?: number } = {},
): Promise<{ answer: AccountAnswer; settled: boolean }> {
  let answer = await fetchAccount(network, address);
  for (let i = 0; i < tries && !done(answer); i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    answer = await fetchAccount(network, address);
  }
  return { answer, settled: done(answer) };
}
