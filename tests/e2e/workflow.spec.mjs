import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  page.on("dialog", (dialog) => dialog.accept());
});

async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible({
    timeout: 10000,
  });
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
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("workspace routes stay inside narrow phone viewports", async ({ page }) => {
  test.setTimeout(90000); // This scenario loads 36 pages across two viewport sizes.
  await signIn(page);

  const routes = [
    "/",
    "/review",
    "/create",
    "/calendar",
    "/more",
    "/clients",
    "/clients/client-a",
    "/clients/client-a/brand",
    "/campaigns",
    "/social",
    "/analytics",
    "/notifications",
    "/settings",
    "/access",
    "/system",
    "/posts/fixture-post",
    "/posts/fixture-post/publish",
    "/posts/fixture-post/reschedule",
  ];

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 360, height: 780 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        undersizedControls: [...document.querySelectorAll('button,[role="button"]')]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
          })
          .map((element) => ({
            label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40),
            width: Math.round(element.getBoundingClientRect().width),
            height: Math.round(element.getBoundingClientRect().height),
          })),
      }));
      expect(
        layout.document <= layout.viewport && layout.body <= layout.viewport,
        `${route} overflows at ${viewport.width}px: ${JSON.stringify(layout)}`,
      ).toBe(true);
      expect(
        layout.undersizedControls,
        `${route} has undersized controls at ${viewport.width}px: ${JSON.stringify(layout.undersizedControls)}`,
      ).toEqual([]);
    }
  }
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

test("browser API errors show a visible, dismissible message", async ({ page }) => {
  await signIn(page);
  await page.goto("/clients");
  await page.route("**/v1/clients", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 403, json: { error: "Client creation denied by fixture" } });
  });
  await page.getByPlaceholder("Client name", { exact: true }).fill("Test client");
  await page.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Unable to create client" })).toBeVisible();
  await expect(page.getByText("Client creation denied by fixture", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("social connection authenticates its API request before navigating to the provider", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/social");
  await page.route("https://www.facebook.com/brandsparq-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><title>Fixture provider</title><body>Provider authorization</body></html>",
    }),
  );
  let authenticated = false;
  await page.route("**/v1/social/connect", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toMatch(/^Bearer .+/);
    expect(route.request().postDataJSON()).toMatchObject({
      platform: "facebook",
      clientId: "client-a",
    });
    expect(new URL(route.request().postDataJSON().returnTo).searchParams.get("clientId")).toBe(
      "client-a",
    );
    authenticated = true;
    await route.fulfill({ json: { authorizationUrl: "https://www.facebook.com/brandsparq-test" } });
  });
  await page.getByRole("button", { name: "Manage facebook accounts", exact: true }).click();
  await page.getByRole("button", { name: "Connect another", exact: true }).click();
  await page.waitForURL("https://www.facebook.com/brandsparq-test");
  expect(authenticated).toBe(true);
  expect(page.url()).not.toContain("token");
});

test("provider callback errors remain visible after a full-page return", async ({ page }) => {
  await signIn(page);
  await page.goto("/social?social_error=Provider%20authorization%20was%20denied");
  await expect(page.getByRole("alert", { name: "Social connection failed" })).toBeVisible();
  await expect(page.getByText("Provider authorization was denied", { exact: true })).toBeVisible();
});

test("generation progress shows failures and supports retry then cancel", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto("/generation?jobId=fixture-generation");
  await expect(page.getByText("Fixture generation failure", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry generation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await expect
    .poll(async () => (await (await request.post("/__test/state")).json()).generationJobs[0].status)
    .toBe("canceled");
});

test("campaign metadata saves and persists after reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/fixture-campaign");
  await page.getByLabel("Campaign name", { exact: true }).fill("Updated community campaign");
  await page.getByLabel("Notes", { exact: true }).fill("Ready for October outreach");
  await page.getByRole("button", { name: "Save campaign", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Campaign saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Updated community campaign",
  );
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Ready for October outreach");
});

test("archived clients can be found and restored explicitly", async ({ page }) => {
  await signIn(page);
  await page.goto("/clients");
  const clientLink = page.getByRole("link", { name: "Open Client A workspace", exact: true });
  const card = clientLink.locator("..");
  await card.getByText("Archive", { exact: true }).click();
  await page.getByRole("button", { name: "Archive client", exact: true }).click();
  await expect(clientLink).toHaveCount(0);
  await page.getByRole("button", { name: "Show archived clients", exact: true }).click();
  await page.getByRole("button", { name: "Restore client", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore client", exact: true })).toHaveCount(0);
  await expect(clientLink).toBeVisible();
});

test("paused approved posts resume through the scheduler", async ({ page, request }) => {
  await signIn(page);
  const token = await page.evaluate(() => sessionStorage.getItem("brandsparq_session"));
  const headers = { authorization: "Bearer " + token };
  expect((await request.post("/v1/posts/fixture-post/approve", { headers })).status()).toBe(200);
  expect(
    (
      await request.post("/v1/posts/bulk/pause", { headers, data: { postIds: ["fixture-post"] } })
    ).status(),
  ).toBe(200);
  await page.goto("/paused");
  await page.getByRole("button", { name: "Resume at next slot", exact: true }).click();
  await expect(page.getByText("No paused posts.", { exact: true })).toBeVisible();
  expect((await (await request.post("/__test/state")).json()).post.status).toBe(
    "calendar_scheduled",
  );
});

test("owners can send and revoke team invitations from Access Management", async ({ page }) => {
  await signIn(page);
  await page.goto("/access");
  await page.getByLabel("Teammate email", { exact: true }).fill("new-member@example.test");
  await page.getByRole("button", { name: "Add Client A", exact: true }).click();
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Invitation created" })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(page.getByText(/new-member@example.test · pending/)).toBeVisible();
  await page.getByRole("button", { name: "Revoke invitation", exact: true }).click();
  await page
    .getByRole("alert", { name: "Revoke invitation?", exact: true })
    .getByRole("button", { name: "Revoke invitation", exact: true })
    .click();
  await expect(page.getByText(/new-member@example.test · revoked/)).toBeVisible();
});

test("reviewer controls send email and revoke replaced review links", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/clients/client-a/reviewers");
  await page.getByLabel("Reviewer email", { exact: true }).fill("client-reviewer@example.test");
  await page.getByRole("button", { name: "Add reviewer", exact: true }).click();
  await expect(page.getByText("client-reviewer@example.test", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send review links", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Review delivery" })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(
    page.getByText("client-reviewer@example.test · sent", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke link", exact: true }).first().click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});

test("viewers see read-only client screens and no creation navigation", async ({ page }) => {
  await page.goto("/login?handoff=viewer-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create", exact: true })).toHaveCount(0);
  await page.goto("/clients");
  await expect(page.getByRole("button", { name: "Create client", exact: true })).toHaveCount(0);
  await page.goto("/clients/client-a/brand");
  await expect(page.getByLabel("Brand voice", { exact: true })).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Save Brand Brain", exact: true })).toHaveCount(0);
  await page.goto("/posts/fixture-post");
  await expect(page.getByRole("button", { name: "Approve post", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewrite caption", exact: true })).toHaveCount(0);
});

test("owner can persist a publishing hold and pilot controls fit narrow screens", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/system");
  await expect(page.getByText("Pilot not enabled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hold publishing", exact: true }).click();
  await expect(page.getByText("Publishing held", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Publishing held", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Configure supervised pilot", exact: true }).click();
  await expect(page.getByLabel("Accepted release commit", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Green CI evidence", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save supervised pilot", exact: true }).click();
  await expect(
    page.getByText(
      "Provide the accepted release commit and a future pilot end within seven days.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("pilot-controls.png"), fullPage: true });
});

test("client hub opens the selected client in the creation workflow", async ({ page }) => {
  await signIn(page);
  await page.goto("/clients");
  await page
    .getByRole("link", { name: /Open .+ workspace/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Client workspace", exact: true })).toBeVisible();
  await expect(page.getByText("Connected channels", { exact: true })).toBeVisible();
  const clientId = new URL(page.url()).pathname.split("/").pop();
  await page.getByRole("button", { name: "Create content", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`clientId=${clientId}`));
  await expect(page.getByRole("button", { name: /Select client:/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose images", exact: true })).toBeVisible();
});

test("profile menu dismisses outside and provides profile and settings", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await page.getByLabel("Close profile menu").click({ position: { x: 5, y: 300 } });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable push", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test", exact: true })).toBeVisible();
});
test("inbox notices navigate, lose new state and can be selected and deleted", async ({
  page,
  request,
}) => {
  await signIn(page);
  await request.post("/__test/inbox");
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Open Review your campaign", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/fixture-post$/);
  await page.goto("/notifications");
  await expect(page.getByText("NEW", { exact: true })).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Select Workspace update", exact: true }).click();
  await page.getByRole("button", { name: "Delete (1)", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Workspace update", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Delete (1)", exact: true }).click();
  await page.reload();
  await expect(page.getByText("No notifications in this view.", { exact: true })).toBeVisible();
});

test("logo upload selects prominent colors and persists them", async ({ page }) => {
  const { encode } = await import("fast-png");
  const pixels = new Uint8Array(10 * 10 * 4);
  for (let i = 0; i < 100; i++) {
    pixels[i * 4 + (i < 80 ? 0 : 2)] = 255;
    pixels[i * 4 + 3] = 255;
  }
  await signIn(page);
  await page.goto("/clients/client-a/brand");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload logo", exact: true }).click();
  await (await chooser).setFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(encode({ width: 10, height: 10, data: pixels, channels: 4 })),
  });
  await expect(page.getByRole("button", { name: "Primary color", exact: true })).toContainText(
    "#FF0000",
  );
  await expect(page.getByRole("button", { name: "Secondary color", exact: true })).toContainText(
    "#0000FF",
  );
  await page.getByRole("button", { name: "Save Brand Brain", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Brand Brain saved" })).toBeVisible();
  await page.getByRole("button", { name: "Close message" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Primary color", exact: true })).toContainText(
    "#FF0000",
  );
});
test("profile name saves and timezone and time pickers support selection", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile");
  await page.getByLabel("Profile name", { exact: true }).fill("Harold Test");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("button", { name: "Close message" }).click();
  await page.reload();
  await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue("Harold Test");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Timezone", exact: true }).click();
  await page.getByLabel("Search Timezone", { exact: true }).fill("UTC");
  await page.getByRole("button", { name: "UTC", exact: true }).click();
  await expect(page.getByRole("button", { name: "Timezone", exact: true })).toContainText("UTC");
  await page
    .getByRole("button", { name: /^From:/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Hour 10", exact: true }).click();
  await page.getByRole("button", { name: "Minute 30", exact: true }).click();
  await page.getByRole("button", { name: "Use time", exact: true }).click();
  await expect(page.getByRole("button", { name: "From: 10:30", exact: true })).toBeVisible();
});

test("secondary screens keep primary navigation reachable", async ({ page }) => {
  await signIn(page);
  for (const route of ["/social", "/analytics", "/campaigns", "/settings", "/clients/client-a"]) {
    await page.goto(route);
    const navigation = page.getByLabel("Workspace navigation", { exact: true });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Calendar", exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  }
});

test("client workspace links retain the selected client", async ({ page }) => {
  await signIn(page);
  const clientId = "client-b";
  await page.goto(`/clients/${clientId}`);
  await page.getByRole("link", { name: "Manage →", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Select client Client B", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`clientId=${clientId}`));
  for (const [label, route] of [
    ["View client calendar →", "calendar"],
    ["View client analytics →", "analytics"],
  ]) {
    await page.goto(`/clients/${clientId}`);
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}.*clientId=${clientId}`));
    await expect(page.getByRole("button", { name: "Client B", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("rescheduling preserves history and refreshes Calendar on return", async ({
  page,
  request,
}) => {
  await page.goto("/review/fixture-review");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(
    page.getByText("This post has been added to the official marketing calendar."),
  ).toBeVisible();
  await signIn(page);
  await page.goto("/calendar");
  await page.getByText("Open →", { exact: true }).first().click();
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page.getByRole("button", { name: /Tomorrow · 9:00 AM/ }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready to publish?", exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(
    (response) => response.url().includes("/v1/posts/calendar") && response.ok(),
  );
  await page
    .getByLabel("Workspace navigation", { exact: true })
    .getByRole("link", { name: "Calendar", exact: true })
    .click();
  await refreshed;
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  const state = await (await request.post("/__test/state")).json();
  expect(state.post.status).toBe("rescheduled");
});

test("unsaved brand edits can be kept, saved or discarded through primary navigation", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/clients/client-a/brand");
  const voice = page.getByLabel("Brand voice", { exact: true });
  await expect(voice).toBeEditable();
  const original = await voice.inputValue();
  await voice.fill("Unsaved brand voice");
  const calendar = () =>
    page
      .getByLabel("Workspace navigation", { exact: true })
      .getByRole("link", { name: "Calendar", exact: true });
  await calendar().click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(voice).toHaveValue("Unsaved brand voice");
  await calendar().click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await page.goto("/clients/client-a/brand");
  await expect(voice).toHaveValue(original);
  await voice.fill("Saved brand voice");
  await page.getByRole("button", { name: "Save Brand Brain", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await calendar().click();
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(
    page.getByRole("alert", { name: "Discard unsaved changes?", exact: true }),
  ).toHaveCount(0);
});

test("campaign edits are protected when opening a post and using back navigation", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/campaigns");
  await page.getByRole("link").filter({ hasText: "Community campaign" }).click();
  await page.getByLabel("Notes", { exact: true }).fill("Keep this unsaved note");
  await page.getByRole("button", { name: "Open post", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Keep this unsaved note");
  await page.getByRole("link", { name: /back$/i }).first().click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Campaigns", exact: true }).first()).toBeVisible();
});

test("header menu protects unsaved settings and client selection is searchable", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Timezone", exact: true }).click();
  await page.getByLabel("Search Timezone", { exact: true }).fill("UTC");
  await page.getByRole("button", { name: "UTC", exact: true }).click();
  await page.getByRole("button", { name: "Open profile menu", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Timezone", exact: true })).toContainText("UTC");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await page.goto("/clients/client-a");
  await page.getByRole("button", { name: "Select client: Client A", exact: true }).click();
  await page.getByLabel("Search clients", { exact: true }).fill("Missing");
  await expect(page.getByText("No matching clients.", { exact: true })).toBeVisible();
  await page.getByLabel("Search clients", { exact: true }).fill("Client B");
  await page.getByRole("button", { name: "Choose Client B", exact: true }).click();
  await expect(page).toHaveURL(/clients\/client-b$/);
  await page.getByRole("button", { name: "Select client: Client B", exact: true }).click();
  await page
    .getByLabel("Close client selector", { exact: true })
    .click({ position: { x: 4, y: 4 } });
  await expect(page.getByLabel("Search clients", { exact: true })).toHaveCount(0);
});

test("disconnect confirmation names the account and cancellation makes no mutation", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/social?clientId=client-a");
  await page.getByRole("button", { name: "Manage facebook accounts", exact: true }).click();
  let disconnects = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/disconnect")) disconnects++;
  });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Disconnect social account?", exact: true }),
  ).toContainText("Test Facebook Page");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(disconnects).toBe(0);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("alert", { name: "Disconnect social account?", exact: true })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect.poll(() => disconnects).toBe(1);
});

test("Calendar labels and API boundaries use a client zone rather than the device zone", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/v1/clients", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const rows = Array.isArray(json) ? json : json.data;
    rows.find((client) => client.id === "client-b").timezone = "Pacific/Auckland";
    await route.fulfill({ response, json });
  });
  await page.goto("/calendar?clientId=client-b");
  await expect(page.getByLabel("Calendar time zone", { exact: true })).toContainText(
    "Pacific/Auckland",
  );
  const response = page.waitForResponse((response) => {
    if (!response.url().includes("/v1/posts/calendar") || !response.ok()) return false;
    const url = new URL(response.url());
    const duration =
      Date.parse(url.searchParams.get("to")) - Date.parse(url.searchParams.get("from"));
    return duration > 0 && duration <= 25 * 3600000;
  });
  await page.getByRole("button", { name: "day", exact: true }).click();
  const url = new URL((await response).url());
  const from = new Date(url.searchParams.get("from"));
  const to = new Date(url.searchParams.get("to"));
  expect(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Pacific/Auckland",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(from),
  ).toBe("00:00");
  expect((to - from) / 3600000).toBe(24);
});

test("post copy is protected on navigation and saved before approval", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.goto("/posts/fixture-post");
  const caption = page.getByLabel("Caption", { exact: true });
  await caption.fill("Approved with my edited copy.");
  await page
    .getByLabel("Workspace navigation", { exact: true })
    .getByRole("link", { name: "Calendar", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(caption).toHaveValue("Approved with my edited copy.");
  await page.getByRole("button", { name: "Approve post", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approved", exact: true })).toBeVisible();
  const state = await (await request.post("/__test/state")).json();
  expect(state.post.caption).toBe("Approved with my edited copy.");
  expect(state.post.status).toBe("calendar_scheduled");
});

test("browser reload can be cancelled without losing unsaved brand edits", async ({ page }) => {
  await signIn(page);
  await page.goto("/clients/client-a/brand");
  const voice = page.getByLabel("Brand voice", { exact: true });
  await expect(voice).toBeEditable();
  await voice.fill("Keep my draft through a cancelled reload");
  let prompts = 0;
  page.removeAllListeners("dialog");
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") {
      prompts++;
      void dialog.dismiss();
    } else void dialog.accept();
  });
  const reload = page.reload({ timeout: 2000 }).catch((error) => {
    expect(error.message).toMatch(/ERR_ABORTED|cancelled|canceled|timeout/i);
  });
  await expect.poll(() => prompts).toBe(1);
  await reload;
  expect(prompts).toBe(1);
  await expect(voice).toHaveValue("Keep my draft through a cancelled reload");
});
