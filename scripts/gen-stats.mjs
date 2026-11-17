/**
 * Counts what the site claims, from the source of truth, and writes
 * lib/generated/stats.json. Pages and the README read those numbers; a unit
 * test checks the README against them, and CI fails if this file is stale.
 *
 *   node scripts/gen-stats.mjs          (runs vitest and forge)
 *   node scripts/gen-stats.mjs --check  (exit 1 if the file would change)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "lib/generated/stats.json";
const check = process.argv.includes("--check");
const isWin = process.platform === "win32";

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, shell: isWin });
  } catch (e) {
    // vitest and forge exit non-zero when a test fails; the JSON is still on stdout or in the file.
    return String(e.stdout ?? "");
  }
}

// Unit tests (vitest): passed and total, per file.
const vitestOut = join(tmpdir(), `fenestella-vitest-${process.pid}.json`);
run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${vitestOut}`]);
const v = JSON.parse(readFileSync(vitestOut, "utf8"));
rmSync(vitestOut, { force: true });
const unitByFile = {};
for (const f of v.testResults) {
  const name = f.name.replace(/\\/g, "/").split("/").pop().replace(/\.test\.ts$/, "");
  unitByFile[name] = f.assertionResults.length;
}
if (v.numFailedTests > 0) throw new Error(`${v.numFailedTests} unit tests fail; fix them before publishing numbers.`);

// Contract tests (forge).
const forge = [join(homedir(), ".foundry", "bin", isWin ? "forge.exe" : "forge"), "forge"].find((p) => p === "forge" || existsSync(p));
const forgeJson = run(forge, ["test", "--root", "contracts", "--json"]);
const suites = JSON.parse(forgeJson.slice(forgeJson.indexOf("{")));
let contractTests = 0;
let contractFailed = 0;
const contractBySuite = {};
for (const [suite, r] of Object.entries(suites)) {
  const results = Object.values(r.test_results ?? {});
  contractBySuite[suite.split(":").pop()] = results.length;
  contractTests += results.length;
  contractFailed += results.filter((t) => t.status !== "Success").length;
}
if (contractFailed > 0) throw new Error(`${contractFailed} contract tests fail.`);

// Attacks in the lab: the entries of ATTACKS in lib/agent/lab.ts.
const lab = readFileSync("lib/agent/lab.ts", "utf8");
const block = lab.slice(lab.indexOf("export const ATTACKS"));
const attacks = [...block.matchAll(/^\s{4}id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);

// Contracts on testnet.
const deployments = JSON.parse(readFileSync("deployments.testnet.json", "utf8"));
const contracts = Object.keys(deployments.contracts).filter((k) => !/V\d+$/.test(k));

const stats = {
  unitTests: v.numTotalTests,
  unitByFile,
  contractTests,
  contractBySuite,
  attacks: attacks.length,
  attackIds: attacks,
  contracts,
};
const next = JSON.stringify(stats, null, 2) + "\n";
const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (check) {
  if (current !== next) {
    console.error(`${OUT} is stale. Run: node scripts/gen-stats.mjs\n--- now ---\n${next}`);
    process.exit(1);
  }
  console.log(`${OUT} is current.`);
} else {
  mkdirSync("lib/generated", { recursive: true });
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT}: ${stats.unitTests} unit tests, ${stats.contractTests} contract tests, ${stats.attacks} attacks`);
}
