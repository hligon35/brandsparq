import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page, request }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});
test("default analytics includes Facebook content published outside BrandSparQ", async ({
  page,
  request,
}) => {
  await page.goto("/analytics");
  await page.getByRole("button", { name: "Sync analytics", exact: true }).click();
  await request.post("/__test/drain-analytics");
  await page.reload();
  await expect(page.getByText("Published directly on Facebook", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View on platform", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "BrandSparQ posts", exact: true }).click();
  await expect(page.getByText("Published directly on Facebook", { exact: true })).toHaveCount(0);
});
test("permission failures are visible while account insights remain unavailable", async ({
  page,
}) => {
  await page.route("**/v1/analytics/overview?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.accounts[0].measurement_status = "needs_attention";
    body.data.accounts[0].error =
      "Permission required or token expired. Enable analytics permissions and reconnect this account.";
    await route.fulfill({ json: body });
  });
  await page.goto("/analytics");
  await expect(page.getByRole("alert").filter({ hasText: "Permission required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage connection", exact: true })).toBeVisible();
});
