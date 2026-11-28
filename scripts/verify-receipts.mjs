#!/usr/bin/env node
/**
 * Re-checks every receipt the docs link to, straight from the QoreChain testnet,
 * with QoreChain's own read-only CLI (`qore`, from @qorechain/qore-cli).
 *
 *   node scripts/verify-receipts.mjs          check (exit 1 on any mismatch)
 *   node scripts/verify-receipts.mjs --init   write docs/proof/receipts.json from the chain
 *
 * docs/proof/receipts.json says, for each transaction hash, what the docs claim
 * it shows: that it landed or was refused, by which layer, with which messages,
 * and whether it carries a verified ML-DSA-87 signature. The check fails if a
 * receipt in the docs is missing from that list, or if the chain no longer says
 * what the list says. It needs no keys and no secrets: it only reads.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = ["README.md", "THREAT_MODEL.md", "AUDIT.md", "AI_USAGE.md"];
const MANIFEST = join(root, "docs", "proof", "receipts.json");
const QORE = join(root, "node_modules", "@qorechain", "qore-cli", "dist", "bin.js");

function qore(...args) {
  for (let attempt = 0; ; attempt++) {
    let out;
    try {
      out = execFileSync(process.execPath, [QORE, ...args, "--network", "testnet", "--json", "--timeout", "20000"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = e.stdout ?? "";
    }
    try {
      const o = JSON.parse(out.replace(/^﻿/, ""));
      if (!o.error || attempt >= 3) return o;
    } catch {
      if (attempt >= 3) return { error: "qore returned no JSON" };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * (attempt + 1));
  }
}

/** Every /tx/<hash> link in the docs, with the line it sits on. */
function receiptsInDocs() {
  const found = new Map();
  for (const f of DOCS) {
    let text;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(/\/tx\/(0x[0-9a-fA-F]{64}|[0-9A-F]{64})/g)) {
        if (!found.has(m[1])) found.set(m[1], { doc: f, line: line.replace(/\]\([^)]*\)/g, "]").replace(/\s+/g, " ").trim().slice(0, 200) });
      }
    }
  }
  return found;
}

/** What the chain says about one transaction, in the terms the manifest uses. */
function observe(hash) {
  const tx = qore("tx", "get", hash);
  if (tx.error || !tx.height) return { error: tx.error ?? "not found" };
  const reason = (tx.execution_failures ?? []).map((f) => f.reason).join("; ") || (tx.failure?.message ?? "");
  const outcome = tx.success ? "landed" : "refused";
  const stoppedBy = tx.success ? null : /execution reverted/.test(reason) ? "contract" : "chain-rule";
  const o = {
    outcome,
    stoppedBy,
    reason: tx.success ? null : reason,
    messages: (tx.messages ?? []).map((m) => m.type_url.split(".").pop()),
    tier: tx.security?.tier ?? null,
    memo: tx.memo || null,
    height: tx.height,
  };
  if (o.tier === "pqc") {
    const pq = qore("pq", "status", hash);
    o.pqcVerified = pq.transaction_status?.verification?.verified === true;
  }
  return o;
}

const init = process.argv.includes("--init");
const docs = receiptsInDocs();

if (init) {
  const entries = [];
  for (const [hash, ctx] of docs) {
    const o = observe(hash);
    if (o.error) throw new Error(`${hash}: ${o.error}`);
    entries.push({
      hash,
      doc: ctx.doc,
      claim: ctx.line,
      expect: {
        outcome: o.outcome,
        ...(o.stoppedBy ? { stoppedBy: o.stoppedBy } : {}),
        messages: o.messages,
        tier: o.tier,
        ...(o.tier === "pqc" ? { pqcVerified: o.pqcVerified } : {}),
        ...(o.memo ? { memo: o.memo } : {}),
        height: o.height,
      },
    });
    process.stdout.write(".");
  }
  writeFileSync(MANIFEST, JSON.stringify({ network: "qorechain-diana", note: "What each receipt linked from the docs shows. Checked daily by scripts/verify-receipts.mjs with @qorechain/qore-cli.", receipts: entries }, null, 2) + "\n");
  console.log(`\nwrote ${entries.length} receipts to docs/proof/receipts.json`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const byHash = new Map(manifest.receipts.map((r) => [r.hash, r]));
const problems = [];
const rows = [];

for (const [hash, ctx] of docs) {
  if (!byHash.has(hash)) problems.push(`${hash.slice(0, 12)}… is linked from ${ctx.doc} but is not in docs/proof/receipts.json`);
}

for (const r of manifest.receipts) {
  const o = observe(r.hash);
  const e = r.expect;
  const bad = [];
  if (o.error) bad.push(`could not be read: ${o.error}`);
  else {
    if (o.outcome !== e.outcome) bad.push(`${o.outcome}, expected ${e.outcome}`);
    if ((e.stoppedBy ?? null) !== o.stoppedBy) bad.push(`stopped by ${o.stoppedBy ?? "nothing"}, expected ${e.stoppedBy ?? "nothing"}`);
    if (o.messages.join("+") !== e.messages.join("+")) bad.push(`messages ${o.messages.join("+")}, expected ${e.messages.join("+")}`);
    if (o.tier !== e.tier) bad.push(`signature tier ${o.tier}, expected ${e.tier}`);
    if (e.pqcVerified && !o.pqcVerified) bad.push("ML-DSA-87 signature no longer verifies");
    if ((e.memo ?? null) !== o.memo) bad.push(`memo changed`);
    if (o.height !== e.height) bad.push(`height ${o.height}, expected ${e.height}`);
  }
  if (!docs.has(r.hash)) bad.push("no longer linked from the docs (remove it from the list)");
  if (bad.length) problems.push(`${r.hash.slice(0, 12)}… (${r.claim.slice(0, 70)}): ${bad.join("; ")}`);
  const what = o.error ? "unreadable" : o.outcome === "landed" ? "landed" : `refused by the ${o.stoppedBy === "contract" ? "contract" : "chain"}`;
  rows.push(`| \`${r.hash.slice(0, 12)}…\` | ${what}${o.pqcVerified ? ", ML-DSA-87 verified" : ""} | ${bad.length ? "❌ " + bad.join("; ") : "✅"} |`);
  process.stdout.write(bad.length ? "x" : ".");
}

const ok = problems.length === 0;
console.log(`\n${manifest.receipts.length} receipts checked against the testnet: ${ok ? "all match the docs" : `${problems.length} problem(s)`}`);
for (const p of problems) console.log(" - " + p);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Receipts re-checked on the QoreChain testnet\n\n${ok ? "Every receipt linked from the docs still says what the docs claim." : `${problems.length} problem(s):\n\n${problems.map((p) => "- " + p).join("\n")}`}\n\n| Receipt | On chain | Check |\n|---|---|---|\n${rows.join("\n")}\n`,
  );
}
process.exit(ok ? 0 : 1);
