import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
});

function platformCard(page, platform) {
  return page.getByRole("group", { name: `${platform} connections`, exact: true });
}

test("a Facebook-only result explains why Instagram still needs connection", async ({ page }) => {
  await page.goto(
    "/social?clientId=client-a&social_connected=meta&connected_accounts=1&connected_clients=1&instagram_accounts=0",
  );
  await expect(
    platformCard(page, "facebook").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(
    platformCard(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
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
    page.getByRole("button", { name: "Select client Imported business", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const platform of ["facebook", "instagram"]) {
    await expect(
      platformCard(page, platform).getByText("Connected", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: platform, exact: true }).locator("..")).toHaveCSS(
      "filter",
      /13, 175, 122/,
    );
    await expect(
      platformCard(page, platform).getByRole("button", { name: "Connect", exact: true }),
    ).toHaveCount(0);
  }
  await page.reload();
  await expect(
    platformCard(page, "instagram").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select client Client B", exact: true }).click();
  await expect(
    platformCard(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
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
    platformCard(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Workspace navigation")
    .getByRole("link", { name: "Calendar", exact: true })
    .click();
  await request.post("/__test/social-imported");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Select client Imported business", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select client Imported business", exact: true }).click();
  await expect(
    platformCard(page, "facebook").getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(
    platformCard(page, "instagram").getByText("Connected", { exact: true }),
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
    platformCard(page, "instagram").getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  let body;
  await page.route("**/v1/social/connect", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: "Fixture intercepted import" } });
  });
  await platformCard(page, "instagram")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect(page.getByRole("alert", { name: "Unable to connect" })).toContainText(
    "Fixture intercepted import",
  );
  expect(body).toMatchObject({ platform: "instagram", clientId: "", importClients: true });
});
