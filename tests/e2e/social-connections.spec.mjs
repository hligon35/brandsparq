import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
});

function platformRow(page, platform) {
  return page.getByRole("group", { name: `${platform} connections`, exact: true });
}

async function selectClient(page, name) {
  await page.getByRole("button", { name: /^Select client:/ }).click();
  await page.getByLabel("Search clients", { exact: true }).fill(name);
  await page.getByRole("button", { name: `Choose ${name}`, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Select client: ${name}`, exact: true }),
  ).toBeVisible();
}

test("a Facebook-only result explains why Instagram still needs connection", async ({ page }) => {
  await page.goto(
    "/social?clientId=client-a&social_connected=meta&connected_accounts=1&connected_clients=1&instagram_accounts=0",
  );
  await expect(platformRow(page, "facebook").getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    platformRow(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Facebook connected, but Meta did not return a linked Instagram account/),
  ).toBeVisible();
});

test("Meta callback selects the returned client and both icons and labels show connected after reload", async ({
  page,
  request,
}) => {
  await request.post("/__test/social-imported");
  await page.goto(
    "/social?clientId=imported-client&social_connected=meta&connected_accounts=2&connected_clients=1",
  );
  await expect(
    page.getByRole("button", { name: "Select client: Imported business", exact: true }),
  ).toBeVisible();
  for (const platform of ["facebook", "instagram"]) {
    await expect(platformRow(page, platform).getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: platform, exact: true }).locator("..")).toHaveCSS(
      "filter",
      /13, 175, 122/,
    );
    await expect(
      platformRow(page, platform).getByRole("button", { name: "Connect", exact: true }),
    ).toHaveCount(0);
  }
  await page.reload();
  await expect(
    platformRow(page, "instagram").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await selectClient(page, "Client B");
  await expect(
    platformRow(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("img", { name: "instagram", exact: true }).locator("..")).toHaveCSS(
    "filter",
    /228, 82, 97/,
  );
});

test("returning through workspace navigation refreshes newly saved social accounts", async ({
  page,
  request,
}) => {
  await page.goto("/social?clientId=client-b");
  await expect(
    platformRow(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Workspace navigation")
    .getByRole("link", { name: "Calendar", exact: true })
    .click();
  await request.post("/__test/social-imported");
  await page.goBack();
  await selectClient(page, "Imported business");
  await expect(platformRow(page, "facebook").getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    platformRow(page, "instagram").getByText("Connected", { exact: true }),
  ).toBeVisible();
});

test("an owner can start importing before creating a client and empty discovery never claims connected", async ({
  page,
}) => {
  await page.route("**/v1/clients", (route) => route.fulfill({ json: { data: [] } }));
  await page.goto("/social?social_error=Meta%20returned%20no%20Facebook%20Pages");
  await expect(page.getByRole("alert", { name: "Social connection failed" })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(
    platformRow(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  let body;
  await page.route("**/v1/social/connect", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: "Fixture intercepted import" } });
  });
  await platformRow(page, "instagram")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByRole("alert", { name: "Unable to connect" })).toContainText(
    "Fixture intercepted import",
  );
  expect(body).toMatchObject({ platform: "instagram", clientId: "", importClients: true });
});

test("compact social rows keep floating icons and right-aligned actions inside a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/social?clientId=client-a");
  await expect(page.getByText("1 of 5 connected", { exact: true })).toBeVisible();
  let previousBottom = 0;
  for (const platform of ["instagram", "facebook", "linkedin", "tiktok", "x"]) {
    const row = platformRow(page, platform);
    const bounds = await row.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(previousBottom);
    previousBottom = bounds.y + bounds.height;
    const icon = await row.getByRole("img", { name: platform, exact: true }).boundingBox();
    expect(icon.width).toBe(44);
    const action =
      platform === "facebook"
        ? row.getByText("Connected", { exact: true })
        : row.getByRole("button", { name: "Connect", exact: true });
    const actionBounds = await action.boundingBox();
    expect(actionBounds.x).toBeGreaterThan(icon.x + icon.width);
    expect(
      Math.abs(actionBounds.y + actionBounds.height / 2 - icon.y - icon.height / 2),
    ).toBeLessThan(3);
    expect(bounds.height).toBeLessThanOrEqual(110);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Manage facebook accounts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("compact-social-list.png"),
    fullPage: true,
  });
});

test("expired connections stay red and verification refreshes the compact status and count", async ({
  page,
}) => {
  let expired = true;
  await page.route("**/v1/social/accounts?clientId=client-a", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (expired) json.data = json.data.map((a) => ({ ...a, token_expires_at: Date.now() - 60000 }));
    await route.fulfill({ response, json });
  });
  await page.route("**/v1/social/accounts/fixture-social/verify", async (route) => {
    expired = false;
    await route.fulfill({
      json: { ok: true, data: { health: "healthy", checkedAt: new Date().toISOString() } },
    });
  });
  await page.goto("/social?clientId=client-a");
  const row = platformRow(page, "facebook");
  await expect(page.getByText("0 of 5 connected", { exact: true })).toBeVisible();
  await expect(row.getByText(/Needs attention/)).toBeVisible();
  await expect(row.getByText("Connected", { exact: true })).toHaveCount(0);
  await expect(row.getByRole("img", { name: "facebook", exact: true }).locator("..")).toHaveCSS(
    "filter",
    /228, 82, 97/,
  );
  await page.getByRole("button", { name: "Manage facebook accounts", exact: true }).click();
  await expect(row.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Make default", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("1 of 5 connected", { exact: true })).toBeVisible();
  await expect(row.getByText("Connected", { exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: "facebook", exact: true }).locator("..")).toHaveCSS(
    "filter",
    /13, 175, 122/,
  );
});
