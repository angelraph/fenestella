import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateMnemonic } from "@qorechain/sdk";

/**
 * Where scripts get their testnet key: FENESTELLA_MNEMONIC, or a throwaway
 * phrase kept in .keys/dev.mnemonic (git-ignored), created on first run.
 * Scripts are testnet only. Never point them at a phrase that guards funds.
 */
export function loadMnemonic(name = "dev"): { mnemonic: string; created: boolean } {
  const fromEnv = name === "dev" ? process.env.FENESTELLA_MNEMONIC?.trim() : undefined;
  if (fromEnv) return { mnemonic: fromEnv, created: false };
  const file = `.keys/${name}.mnemonic`;
  if (existsSync(file)) return { mnemonic: readFileSync(file, "utf8").trim(), created: false };
  mkdirSync(".keys", { recursive: true });
  const mnemonic = generateMnemonic(256);
  writeFileSync(file, mnemonic + "\n", { mode: 0o600 });
  return { mnemonic, created: true };
}

export const FAUCET = "https://dashboard.qorechain.io/faucet";

export function step(n: number, text: string) {
  console.log(`\n[${n}] ${text}`);
}

export function ok(text: string) {
  console.log(`    ok   ${text}`);
}

export function fail(text: string) {
  console.log(`    FAIL ${text}`);
}

export function info(text: string) {
  console.log(`         ${text}`);
}
