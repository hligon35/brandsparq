import { test, expect } from "@playwright/test";
const image = {
  name: "creation.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmMQ0bD5DwACRAF41rdyCgAAAABJRU5ErkJggg==",
    "base64",
  ),
};
test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  page.on("dialog", (dialog) => dialog.accept());
});
async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible({
    timeout: 10000,
  });
}
test("profile load has a persistent retry and recovered edits stay protected until saved", async ({
  page,
}) => {
  await signIn(page);
  let first = true;
  await page.route("**/v1/profile", async (route) => {
    if (first && route.request().method() === "GET") {
      first = false;
      await route.fulfill({ status: 503, json: { error: "Profile temporarily unavailable" } });
    } else await route.continue();
  });
  await page.goto("/profile");
  await expect(page.getByText("Profile temporarily unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByLabel("Profile name", { exact: true })).toBeEnabled();
  await page.getByLabel("Profile name", { exact: true }).fill("Recovered owner");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).some(
          (key) => key.startsWith("brandsparq_profile_") && !key.includes("_undefined"),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue("Recovered owner");
  await page.getByRole("button", { name: "Open profile menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/profile$/);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue("Recovered owner");
});
test("notification opens its destination when saving read status fails and retains its new state", async ({
  page,
  request,
}) => {
  await request.post("/__test/inbox");
  await signIn(page);
  await page.goto("/notifications");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/notifications/inbox-one/read", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: "Read service unavailable" } });
  });
  await page.getByRole("button", { name: "Open Review your campaign", exact: true }).click();
  await expect(page).toHaveURL(/posts\/fixture-post$/);
  release();
  await expect(page.getByText("Read status not saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await page.goto("/notifications");
  await expect(
    page.getByText("2 new · Tap a notification to open it.", { exact: true }),
  ).toBeVisible();
});
test("personal alert preferences are editable for a viewer and exclude workspace controls from writes", async ({
  page,
}) => {
  await page.route("**/v1/auth/session", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.user.role = "viewer";
    body.user.clientRoles = { "client-a": "viewer" };
    await route.fulfill({ response, json: body });
  });
  await signIn(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("switch", { name: "Email notifications", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Timezone", exact: true })).toBeDisabled();
  await page.getByRole("switch", { name: "Email notifications", exact: true }).click();
  const saving = page.waitForRequest(
    (request) => request.url().endsWith("/v1/settings") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  const body = (await saving).postDataJSON();
  expect(body.workspace).toBeUndefined();
  expect(body.notifications.emailEnabled).toBe(false);
  expect(body.notifications.noResponsePolicy).toBeUndefined();
});
test("partial analytics sync failures are visible and missing metrics display unavailable", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/v1/analytics/sync", (route) =>
    route.fulfill({
      json: {
        ok: false,
        results: [
          {
            accountId: "fixture-social",
            ok: false,
            error: "Provider unavailable; previous metrics retained.",
          },
        ],
      },
    }),
  );
  await page.goto("/analytics");
  await expect(
    page.getByText("Metrics unavailable until a successful provider sync.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sync analytics", exact: true }).click();
  await expect(page.getByText("Analytics needs attention", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Provider unavailable; previous metrics retained.", { exact: true }),
  ).toBeVisible();
});
test("generation history loads past the first page and searches the complete authorized history", async ({
  page,
  request,
}) => {
  await request.post("/__test/old-generation");
  await signIn(page);
  await page.goto("/generation");
  await page.getByRole("button", { name: "Load more jobs", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open campaign", exact: true })).toBeVisible();
  await page.getByLabel("Search generation jobs", { exact: true }).fill("No matching client");
  await expect(page.getByText("No generation jobs yet.", { exact: true })).toBeVisible();
  await page.getByLabel("Search generation jobs", { exact: true }).fill("Client A");
  await expect(page.getByRole("button", { name: "Load more jobs", exact: true })).toBeVisible();
});
test("an unconfirmed creation request survives reload and retry reuses the original identity without uploading twice", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "Create a social post", exact: true }).click();
  await page.getByRole("button", { name: "facebook · Test Facebook Page", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose images", exact: true }).click();
  await (await chooser).setFiles(image);
  let first = true,
    uploads = 0;
  const keys = [];
  await page.route("**/v1/assets", async (route) => {
    uploads++;
    await route.continue();
  });
  await page.route("**/v1/creation-jobs", async (route) => {
    keys.push(route.request().postDataJSON().requestKey);
    if (first) {
      first = false;
      await route.fetch();
      await route.fulfill({ status: 503, json: { error: "Response lost" } });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Create social post", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry creation request", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() => {
    const key = "brandsparq_create_owner",
      manifest = JSON.parse(sessionStorage.getItem(key));
    return JSON.parse(
      Array.from({ length: manifest.count }, (_, i) =>
        sessionStorage.getItem(`${key}_${manifest.version}_${i}`),
      ).join(""),
    );
  });
  expect(saved.items[0].source.uri).toBe("");
  expect(saved.items[0].source.base64).toBeUndefined();
  expect(saved.items[0].source.file).toBeUndefined();
  await page.reload();
  await expect(
    page.getByText("Recovered an unconfirmed request. Retry uses the same request identity.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry creation request", exact: true }).click();
  await expect(page).toHaveURL(/generation\?jobId=/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(uploads).toBe(1);
  expect(
    (await (await request.post("/__test/state")).json()).generationJobs.filter(
      (job) => job.creation_options,
    ),
  ).toHaveLength(1);
});

test("notification pagination reaches older items and the badge counts the complete inbox", async ({
  page,
  request,
}) => {
  await request.post("/__test/large-inbox");
  await signIn(page);
  await page.goto("/notifications");
  await expect(
    page.getByText("105 new · Tap a notification to open it.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications, 105 unread", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more notifications", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open History message 0", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search notifications", { exact: true }).fill("History message 0");
  await expect(
    page.getByRole("button", { name: "Open History message 0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open History message 1", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Open History message 0", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open History message 0", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("104 new · Tap a notification to open it.", { exact: true }),
  ).toBeVisible();
});
test("a late capability refresh cannot restore the user after signing out", async ({ page }) => {
  await page.clock.install();
  await signIn(page);
  let began, release;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/auth/session", async (route) => {
    const response = await route.fetch();
    began();
    await gate;
    await route.fulfill({ response });
  });
  await page.clock.fastForward(61000);
  await started;
  await page.getByRole("button", { name: "Open profile menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/v1/auth/session"));
  release();
  await (await refreshed).finished();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toHaveCount(0);
});
test("ownership can be handed over and stepping down immediately removes owner controls", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/access");
  await page.getByText("viewer@example.test", { exact: true }).click();
  await page.getByRole("button", { name: "Promote to owner", exact: true }).click();
  await page.getByRole("button", { name: "Change role", exact: true }).click();
  await expect(page.getByRole("button", { name: "Promote to owner", exact: true })).toHaveCount(0);
  await page.getByText("owner@example.test", { exact: true }).click();
  await page.getByRole("button", { name: "admin", exact: true }).last().click();
  await page.getByRole("button", { name: "Change role", exact: true }).click();
  await expect(
    page.getByText("Only workspace owners can manage access.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create invitation", exact: true })).toHaveCount(0);
});
