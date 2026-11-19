/**
 * The stop button, end to end in a real browser against testnet:
 * connect a test account, link the agent, press "Stop the agent now",
 * and check on chain that no key is left linked and no window is open.
 *
 *   npx tsx scripts/spike-stop.ts [siteUrl=http://localhost:3000] [account=demo4]
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { readAccount } from "../lib/chain/read";

const site = process.argv[2] ?? "http://localhost:3000";
const name = process.argv[3] ?? "demo4";
const mnemonic = readFileSync(`.keys/${name}.mnemonic`, "utf8").trim();

const acct = await deriveUnifiedAccount(mnemonic);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120_000);
const log = (s: string) => console.log(`  ${s}`);

await page.goto(`${site}/agent`, { waitUntil: "networkidle" });
await page.locator(".header-wallet-desktop button", { hasText: "Connect wallet" }).click();
await page.locator(".wallet-row", { hasText: "QoreChain Dashboard wallet" }).click();
await page.locator("#dash-addr").fill(acct.cosmos);
await page.locator("#dash-phrase").fill(mnemonic);
await page.getByRole("button", { name: "Check and connect" }).click();
// Connecting from the header opens the account page; go back to the agent page in-app, so the wallet stays connected.
await page.waitForURL(/\/account\//);
await page.locator(".site-nav a", { hasText: "Agent" }).click();
try {
  await page.locator("#stop").waitFor({ timeout: 60_000 });
} catch (e) {
  const errs = await page.locator(".notice.err, [role=alert]").allInnerTexts();
  await page.screenshot({ path: process.env.SHOT ?? "stop-fail.png", fullPage: false });
  console.log(`  not connected; errors on page: ${JSON.stringify(errs)}; url ${page.url()}`);
  throw e;
}
log(`connected ${acct.cosmos}; stop card says: ${(await page.locator("#stop .stop-head").innerText()).replace(/\n+/g, " | ")}`);

// Wait until the agent panel has read the account: either the link button or the "Linked" pill shows.
await page.locator(".agent-step").nth(0).locator("button:has-text('Link the agent'), .pill.active").first().waitFor();
if (await page.getByRole("button", { name: "Link the agent" }).isVisible()) {
  await page.getByRole("button", { name: "Link the agent" }).click();
  await page.locator(".agent-step").nth(0).locator(".pill.active").waitFor();
  log("agent linked");
}
await page.locator("#stop .stop-btn").waitFor();
log(`armed: ${(await page.locator("#stop .stop-head p").innerText())}`);
await page.locator("#stop .stop-btn").click();
await page.locator("#stop .steps li").first().waitFor();
await page.waitForTimeout(9000);
for (const li of await page.locator("#stop .steps li").all()) log(`step: ${(await li.innerText()).replace(/\n+/g, " ")}`);
log(`after: ${(await page.locator("#stop .stop-head").innerText()).replace(/\n+/g, " | ")}`);

const t = await readAccount("testnet", acct.cosmos);
const now = BigInt(Math.floor(Date.now() / 1000));
const live = t.abstractAccount.authenticators.filter((a) => !a.revoked && BigInt(a.expiryUnix) > now);
log(`chain: ${live.length} live keys, window ${t.window?.live ? "OPEN" : "closed"}`);
await browser.close();
if (live.length || t.window?.live) process.exit(1);
