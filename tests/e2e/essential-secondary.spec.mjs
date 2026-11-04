import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});

test("secondary Essential screens fit phone and tablet widths with expanded details", async ({
  page,
}) => {
  test.setTimeout(180000);
  const routes = [
    "/review",
    "/posts/fixture-post",
    "/posts/fixture-post/publish",
    "/posts/fixture-post/reschedule",
    "/clients/client-a",
    "/clients/client-a/brand",
    "/clients/client-a/reviewers",
    "/campaigns",
    "/campaigns/fixture-campaign",
    "/generation",
    "/paused",
    "/analytics",
    "/system",
    "/access",
    "/notifications",
    "/profile",
    "/settings",
  ];
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
          message: `${route} fits ${width}px`,
        })
        .toBe(true);
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/clients/client-a/brand");
  await page.getByRole("button", { name: "Visual direction", exact: true }).click();
  await expect(page.getByLabel("Imagery preferences", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/system");
  await page.getByRole("button", { name: "Publishing controls", exact: true }).click();
  await expect(page.getByText("Pilot not enabled", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("analytics keeps completed job history in Health and preserves the selected client", async ({
  page,
  request,
}) => {
  await request.post("/__test/published");
  await page.goto("/analytics?clientId=client-a");
  await page.getByRole("button", { name: "Sync analytics", exact: true }).click();
  await expect(page.getByText(/processed.*failed/)).toHaveCount(0);
  await page.getByRole("button", { name: "Connection & sync health", exact: true }).click();
  await expect(page).toHaveURL(/system\?clientId=client-a/);
  await expect(page.getByText(/30 days.*queued/)).toBeVisible();
  await request.post("/__test/drain-analytics");
  await page.reload();
  await page.getByRole("button", { name: "Show sync history", exact: true }).click();
  await expect(page.getByText(/30 days.*completed.*1 processed/)).toBeVisible();
});

test("viewer can inspect assigned health without owner requests or controls", async ({
  page,
  request,
}) => {
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/login?handoff=viewer-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  const ownerRequests = [];
  page.on("request", (r) => {
    if (/\/v1\/system\//.test(r.url())) ownerRequests.push(r.url());
  });
  await page.goto("/system");
  await expect(page.getByRole("button", { name: "Analytics sync", exact: true })).toBeVisible();
  await expect(page.getByText("Loading health information…")).toHaveCount(0);
  await expect(page.getByText("Workspace operations", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recover stuck work", exact: true })).toHaveCount(
    0,
  );
  expect(ownerRequests).toEqual([]);
});

test("grouped brand fields keep unsaved edits when a section is collapsed", async ({ page }) => {
  await page.goto("/clients/client-a/brand");
  const field = page.getByLabel("Brand voice", { exact: true });
  await field.fill("Keep this voice while switching sections");
  await page.getByRole("button", { name: "Voice & audience", exact: true }).click();
  await expect(field).not.toBeVisible();
  await page.getByRole("button", { name: "Voice & audience", exact: true }).click();
  await expect(field).toHaveValue("Keep this voice while switching sections");
  await page.getByRole("button", { name: "Save Brand Brain", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await page.reload();
  await expect(field).toHaveValue("Keep this voice while switching sections");
});
