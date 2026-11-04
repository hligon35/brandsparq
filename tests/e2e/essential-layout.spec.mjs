import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});

test("Essential screens fit narrow phones and retain working client creation and calendar selection", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 320, height: 760 });
  for (const [route, heading] of [
    ["/", "Your workspace"],
    ["/clients", "Your clients"],
    ["/create", "What are we making?"],
    ["/calendar", "Calendar"],
    ["/more", "More"],
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const cards = await Promise.all(
    [
      "Review queue",
      "Campaigns",
      "Social connections",
      "Analytics",
      "Access management",
      "System health",
    ].map((name) => page.getByRole("link", { name: new RegExp(name) }).boundingBox()),
  );
  expect(
    Math.max(...cards.map((c) => c.height)) - Math.min(...cards.map((c) => c.height)),
  ).toBeLessThan(2);
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add client", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Client name", { exact: true }).fill("Essential test client");
  await dialog.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Essential test client client card", exact: true }),
  ).toBeVisible();
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Select client: All clients", exact: true }).click();
  await page.getByRole("button", { name: "Choose Client B", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Select client: Client B", exact: true }),
  ).toBeVisible();
});

test("client removal requires confirmation and stays removed after reload and archived filtering", async ({
  page,
}) => {
  await page.goto("/clients");
  const card = page.getByRole("group", { name: "Client A client card", exact: true });
  await card.getByRole("button", { name: "Remove Client A", exact: true }).click();
  const confirmation = page.getByRole("alert", { name: "Remove client?", exact: true });
  await expect(confirmation).toContainText("Client A");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Remove Client A", exact: true }).click();
  await confirmation.getByRole("button", { name: "Remove client", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Client B client card", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show archived clients", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Client B client card", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
});
