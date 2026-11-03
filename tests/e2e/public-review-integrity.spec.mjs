import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
test("public request changes saves visible edited copy before changing status", async ({
  page,
  request,
}) => {
  await page.goto("/review/fixture-review");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Keep my requested correction");
  await page.getByRole("button", { name: "Request changes", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Changes requested", exact: true })).toBeVisible();
  const post = (await (await request.get("/v1/public/review/fixture-review")).json()).data;
  expect(post.caption).toBe("Keep my requested correction");
  expect(post.status).toBe("edit_requested");
});
test("public approval retry uses the saved revision after a failed follow-up", async ({
  page,
  request,
}) => {
  let attempts = 0;
  await page.route("**/v1/public/review/fixture-review/approve", async (route) => {
    if (++attempts === 1)
      await route.fulfill({ status: 503, json: { error: "Temporary approval outage" } });
    else await route.continue();
  });
  await page.goto("/review/fixture-review");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Saved once and safe to retry");
  await page.getByRole("button", { name: "Approve and add to calendar", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approval failed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(caption).toHaveValue("Saved once and safe to retry");
  await page.getByRole("button", { name: "Approve and add to calendar", exact: true }).click();
  await expect(
    page.getByText("This post has been added to the official marketing calendar."),
  ).toBeVisible();
  expect((await (await request.get("/v1/public/review/fixture-review")).json()).data.caption).toBe(
    "Saved once and safe to retry",
  );
});
test("public regeneration failure keeps saved copy and the unsent instruction", async ({
  page,
  request,
}) => {
  await page.route("**/v1/public/review/fixture-review/regenerate", (route) =>
    route.fulfill({ status: 503, json: { error: "Temporary generation outage" } }),
  );
  await page.goto("/review/fixture-review");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Retain this caption");
  const instruction = page.getByPlaceholder("Optional regeneration instruction");
  await instruction.fill("Use a lighter background");
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Unable to regenerate", exact: true }),
  ).toBeVisible();
  await expect(caption).toHaveValue("Retain this caption");
  await expect(instruction).toHaveValue("Use a lighter background");
  expect((await (await request.get("/v1/public/review/fixture-review")).json()).data.caption).toBe(
    "Retain this caption",
  );
});

test("expired signed preview renews without replacing unsaved copy", async ({ page }) => {
  let release;
  const ready = new Promise((resolve) => (release = resolve));
  let images = 0;
  await page.route("**/v1/public/media/*", async (route) => {
    if (++images === 1) {
      await ready;
      await route.fulfill({ status: 401, body: "Expired preview" });
    } else await route.continue();
  });
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  await page.goto("/posts/fixture-post");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Do not replace my unsaved draft");
  release();
  await expect.poll(() => images).toBeGreaterThan(1);
  const image = page.locator('img[src*="/v1/public/media/"]').first();
  await expect
    .poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0))
    .toBe(true);
  await expect(caption).toHaveValue("Do not replace my unsaved draft");
});
