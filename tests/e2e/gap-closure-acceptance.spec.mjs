import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
}
test("paused recovery reaches the oldest item after two more pages and returns it to review", async ({
  page,
  request,
}) => {
  await request.post("/__test/large-paused");
  await signIn(page);
  await page.goto("/paused");
  const oldest = page.getByText("Oldest paused recovery", { exact: true });
  await expect(oldest).toHaveCount(0);
  await page.getByRole("button", { name: "Load more paused posts", exact: true }).click();
  await expect(oldest).toHaveCount(0);
  await page.getByRole("button", { name: "Load more paused posts", exact: true }).click();
  await expect(oldest).toBeVisible();
  const save = page.waitForResponse((r) => r.url().includes("/recovery-000/restore-review"));
  await oldest.locator("..").getByRole("button", { name: "Return to review", exact: true }).click();
  expect((await save).status()).toBe(200);
  await expect(oldest).toHaveCount(0);
  await page.getByLabel("Search paused content", { exact: true }).fill("Paused recovery 104");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Paused recovery 104", { exact: true })).toBeVisible();
});
test("generation polling removes jobs that leave the selected status", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto("/generation");
  await page.getByRole("button", { name: "failed", exact: true }).click();
  await expect(page.getByText("Fixture generation failure", { exact: true })).toBeVisible();
  await request.post("/__test/complete-generation");
  await expect(page.getByText("Fixture generation failure", { exact: true })).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(page.getByText("No generation jobs yet.", { exact: true })).toBeVisible();
});
test("analytics queued progress survives reload and advances after durable queue delivery", async ({
  page,
  request,
}) => {
  await request.post("/__test/published");
  await signIn(page);
  await page.goto("/analytics");
  await page.getByRole("button", { name: "Sync analytics", exact: true }).click();
  await expect(page.getByText(/Test Facebook Page.*queued/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Test Facebook Page.*queued/)).toBeVisible();
  await request.post("/__test/drain-analytics");
  await expect(page.getByText(/Test Facebook Page.*completed.*1 processed/)).toBeVisible({
    timeout: 10000,
  });
});
