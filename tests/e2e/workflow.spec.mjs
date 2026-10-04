import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  page.on("dialog", (dialog) => dialog.accept());
});

async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(
    page.getByRole("heading", { name: "Marketing moves faster with a system." }),
  ).toBeVisible();
}

test("login is accessible, fits the viewport, and restores a signed-in session after refresh", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await signIn(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Marketing moves faster with a system." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Brand Brain persists edits through the real authenticated API", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/clients/client-a/brand");
  await page.getByLabel("Brand voice", { exact: true }).fill("Clear, friendly and local");
  await page.getByLabel("Audience", { exact: true }).fill("Local business owners");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/clients/client-a/brand") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save Brand Brain" }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Brand voice", { exact: true })).toHaveValue(
    "Clear, friendly and local",
  );
  expect((await request.post("/__test/state")).ok()).toBe(true);
});

test("review edits and approval flow through calendar, publishing, notifications and analytics", async ({
  page,
  request,
}) => {
  await page.goto("/review/fixture-review");
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("Launch campaign");
  await page.getByLabel("Caption", { exact: true }).fill("Ready for the community launch.");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(
    page.getByText("This post has been added to the official marketing calendar."),
  ).toBeVisible();
  await signIn(page);
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  let state = await (await request.post("/__test/state")).json();
  expect(state.post.status).toBe("calendar_scheduled");
  await page.goto("/posts/fixture-post/publish");
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await expect
    .poll(async () => (await (await request.post("/__test/state")).json()).post.status)
    .toBe("publish_queued");
  expect((await request.post("/__test/drain")).status()).toBe(200);
  state = await (await request.post("/__test/state")).json();
  expect(state.post.status).toBe("published");
  expect(
    state.notifications.some((item) => item.type === "published" && item.status === "sent"),
  ).toBe(true);
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics", exact: true }).first()).toBeVisible();
  await expect(page.getByText("120", { exact: true }).first()).toBeVisible();
});

test("expired sessions return to login and clear the stale web token", async ({
  page,
  request,
}) => {
  await signIn(page);
  await request.post("/__test/expire");
  await page.goto("/review");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("brandsparq_session"))).toBeNull();
});

test("failed review links show a recovery state and never enable approval", async ({ page }) => {
  await page.goto("/review/expired-token");
  await expect(page.getByText("Review link unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
});
