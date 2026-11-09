import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});
test("review virtualizes a long queue and retains selection across a search", async ({
  request,
  page,
}) => {
  await request.post("/__test/large-review");
  await page.goto("/review");
  const target = page.getByRole("checkbox", { name: "Select Review batch 0", exact: true });
  await expect(target).toBeVisible();
  await target.check();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  expect(await page.getByRole("checkbox").count()).toBeLessThan(120);
  const search = page.getByPlaceholder("Search client, platform, headline, or caption");
  await search.fill("Review batch 119");
  await expect(
    page.getByRole("checkbox", { name: "Select Review batch 119", exact: true }),
  ).toBeVisible();
  await search.fill("Review batch 0");
  await expect(target).toBeChecked();
});
test("notification search remains usable with a large virtualized inbox", async ({
  request,
  page,
}) => {
  await request.post("/__test/large-inbox");
  await page.goto("/notifications");
  await expect(
    page.getByRole("checkbox", { name: "Select History message 104", exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("checkbox").count()).toBeLessThan(50);
  await page.getByLabel("Search notifications", { exact: true }).fill("History message 0");
  await expect(
    page.getByRole("checkbox", { name: "Select History message 0", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Select History message 0", exact: true }).check();
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  await expect(
    page.getByText("0 new · Tap a notification to open it.", { exact: true }),
  ).toBeVisible();
});
test("foreground refresh preserves unsaved review copy", async ({ request, page }) => {
  await page.goto("/posts/fixture-post");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Keep local unsaved copy on foreground");
  let refreshes = 0;
  await page.route("**/v1/posts/fixture-post", async (route) => {
    refreshes++;
    await route.continue();
  });
  // Browser visibility drives React Native Web AppState; device acceptance covers real backgrounding.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await expect(caption).toHaveValue("Keep local unsaved copy on foreground");
});
