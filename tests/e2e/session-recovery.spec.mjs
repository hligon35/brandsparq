import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
}
const hasCredential = (page) => page.evaluate(() => !!sessionStorage.getItem("brandsparq_session"));

test("offline session restoration retains the credential and offers a working retry", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/v1/auth/session", (route) =>
    route.fulfill({ status: 503, json: { error: "Session temporarily unavailable" } }),
  );
  await page.reload();
  await expect(page.getByText("Session temporarily unavailable", { exact: true })).toBeVisible();
  expect(await hasCredential(page)).toBe(true);
  await page.unroute("**/v1/auth/session");
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});

test("a session body that never completes ends in recovery instead of an endless spinner", async ({
  page,
}) => {
  await signIn(page);
  await page.addInitScript(() => {
    window.holdSession = true;
    const original = window.fetch;
    window.fetch = (...args) => {
      if (window.holdSession && String(args[0]).endsWith("/v1/auth/session"))
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{"user":'));
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      return original(...args);
    };
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(page.getByRole("progressbar", { name: "Restoring session" })).toHaveCount(0);
  expect(await hasCredential(page)).toBe(true);
  await page.evaluate(() => {
    window.holdSession = false;
  });
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});

test("local sign out completes while remote revocation is unavailable", async ({ page }) => {
  await signIn(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/auth/logout", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.getByRole("button", { name: "Open profile menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  expect(await hasCredential(page)).toBe(false);
  release();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
});
