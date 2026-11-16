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

test("the agent page shows its AI and its leash steps", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.locator("h1")).toContainText("An AI agent that can pay your bills");
  await expect(page.getByText("Connect the account the agent will pay from")).toBeVisible();
  // Without a wallet, the AI panel reads for the demo account and offers the three sample invoices.
  await expect(page.getByRole("heading", { name: /No wallet\? Watch the agent's AI/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Phishing: new address, urgent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prompt injection" })).toBeVisible();
});
