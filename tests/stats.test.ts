import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import stats from "../lib/generated/stats.json";

/**
 * Every number the README states about tests is checked against
 * lib/generated/stats.json, which scripts/gen-stats.mjs writes from real
 * vitest and forge runs. A stale claim fails here; a stale stats file fails CI.
 */
const readme = readFileSync("README.md", "utf8");
const threat = readFileSync("THREAT_MODEL.md", "utf8");

describe("published numbers match the real test runs", () => {
  it("README totals", () => {
    expect(readme).toContain(`npm test           # ${stats.unitTests} unit tests`);
    expect(readme).toContain(`forge test   # ${stats.contractTests} contract tests`);
    expect(readme).toContain(`(${stats.contractTests} Foundry tests pass;`);
  });

  it("README per-file counts", () => {
    expect(readme).toContain(`with five outcomes and ${stats.unitByFile.exposure} unit tests:`);
    expect(readme).toContain(`(lib/agent/policy.ts) checks the draft (${stats.unitByFile.policy} tests)`);
    expect(readme).toContain(`(lib/agent/autopay.ts), ${stats.unitByFile.autopay} tests)`);
    expect(readme).toContain(`(lib/agent/guard.ts), ${stats.unitByFile.guard} tests)`);
    expect(threat).toContain(`**Verified** by ${stats.contractBySuite.AgentVaultTest} Foundry tests`);
  });

  it("the lab has the attacks the site counts", () => {
    expect(stats.attacks).toBe(stats.attackIds.length);
    expect(new Set(stats.attackIds).size).toBe(stats.attacks);
  });
});
