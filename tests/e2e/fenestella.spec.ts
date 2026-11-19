import { expect, test } from "@playwright/test";

const DEV = "qor18ydtk2rx0wma4csyl9353kj0z29w645daa47z9";
const PAID = "7A9F06EE6FA017A934E58A51C61C3FB5F21AD73DF082F27E152C39C48D349D18";
const REFUSED = "8210C92541CAE458D6C05C443F13EA913D421CF514985DEF4FF8452F8BA5A042";

test("reads an account and answers in one sentence", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Account address").fill(DEV);
  await page.getByRole("button", { name: "Read account" }).click();
  await expect(page.locator(".exposure .headline")).toBeVisible();
  await expect(page.locator(".exposure")).toHaveAttribute("data-level", /sealed|scoped|open|takeover/);
  await expect(page.locator(".facts")).toContainText("ML-DSA-87 registered");
});

test("receipt pages read testnet transactions", async ({ page }) => {
  await page.goto(`/tx/${PAID}`);
  await expect(page.locator(".notice.ok")).toContainText("Succeeded");
  await expect(page.locator(".facts")).toContainText("ML-DSA-87 hybrid, verified");
  await page.goto(`/tx/${REFUSED}`);
  await expect(page.locator(".notice.err")).toContainText("per-tx limit");
});

test("the landing page shows live proof that slides, with numbers from the real test runs", async ({ page }) => {
  const stats = (await import("../../lib/generated/stats.json", { with: { type: "json" } })).default;
  await page.goto("/");
  const stage = page.locator(".lv-stage");
  await expect(stage).toBeVisible();
  await expect(page.locator(".lv-slide.is-active")).toContainText(`of ${stats.attacks} refused`);
  await stage.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".lv-slide.is-active")).toContainText("How the agent is kept honest");
  await expect(page.locator(".proof")).toContainText(String(stats.contractTests));
  await expect(page.locator(".proof")).toContainText(String(stats.unitTests));
});

test("the attack lab publishes every recorded attempt, with the chain's reason and a receipt", async ({ page }) => {
  await page.goto("/lab#log");
  const items = page.locator("#log .log-item");
  await expect(items.first()).toBeVisible();
  await expect(items.first().locator(".log-by")).toHaveText(/Stopped by the (chain|vault)|Got through/);
  await expect(items.first().getByRole("link", { name: /receipt/ })).toHaveAttribute("href", /^\/tx\/[0-9A-F]{64}$/);
});

test("an account with an agent shows the agent's record from the chain, no wallet needed", async ({ page }) => {
  await page.goto("/account/qor1072yq0ksuukxkym8d9r0mpr3upz4awf00u5ew7?network=testnet");
  const hist = page.locator(".hist");
  await expect(hist.locator(".hist-item").first()).toBeVisible({ timeout: 60_000 });
  await expect(hist.locator(".hist-sum")).toContainText(/payment/);
  await expect(hist.locator(".hist-item").first().getByRole("link", { name: "receipt" })).toHaveAttribute("href", /^\/tx\/[0-9A-F]{64}$/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("every page is reachable from the menu, wallet included", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".site-nav")).toBeHidden();
    const menu = page.getByRole("button", { name: "Open menu" });
    await expect(menu).toBeVisible();
    await menu.click();
    const panel = page.locator("#site-menu-panel");
    await expect(panel.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    for (const label of ["Console", "Agent", "Attack lab", "Radar", "For dApps", "Docs", "FAQ", "Security"]) {
      await expect(panel.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    // The wallet comes last, under every page.
    const security = await panel.getByRole("link", { name: /^Security/ }).boundingBox();
    const wallet = await panel.getByRole("button", { name: "Connect wallet" }).boundingBox();
    expect(wallet!.y).toBeGreaterThan(security!.y);
    await panel.getByRole("link", { name: /^Attack lab/ }).click();
    await expect(page).toHaveURL(/\/lab$/);
    await expect(panel).toBeHidden();
  });

  for (const path of ["/", "/agent", "/lab", "/radar", "/demo", "/docs", "/faq", "/security", `/account/${DEV}?network=testnet`, "/account/qor1072yq0ksuukxkym8d9r0mpr3upz4awf00u5ew7?network=testnet"]) {
    test(`nothing is wider than the screen: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(375);
    });
  }
});

test("the agent page shows its AI and its leash steps", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.locator("h1")).toContainText("An AI agent that can pay your bills");
  await expect(page.getByText("Connect the account the agent will pay from")).toBeVisible();
  // Without a wallet, the AI panel reads for the demo account and offers the three sample invoices.
  await expect(page.getByRole("heading", { name: /No wallet\? Watch the agent's AI/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Phishing: new address, urgent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prompt injection" })).toBeVisible();
});
