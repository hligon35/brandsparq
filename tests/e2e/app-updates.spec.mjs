import { test, expect } from "@playwright/test";

test("Settings shows web refresh first and protects unsaved changes before reloading", async ({
  page,
  request,
}) => {
  await request.post("/__test/reset");
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  await page.goto("/settings");
  const refresh = page.getByRole("button", { name: "Refresh web app", exact: true });
  await expect(refresh).toBeVisible();
  const devices = await page
    .getByRole("heading", { name: "Notification devices", exact: true })
    .boundingBox();
  expect((await refresh.boundingBox()).y).toBeLessThan(devices.y);
  await expect(page.getByRole("button", { name: "Check for app update", exact: true })).toHaveCount(
    0,
  );
  const email = page.getByRole("switch", { name: "Email notifications", exact: true });
  await expect(email).toBeEnabled();
  const checked = await email.isChecked();
  await email.click();
  await refresh.click();
  await page
    .getByRole("alert", { name: "Refresh web app?", exact: true })
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  const discard = page.getByRole("alert", { name: "Discard unsaved changes?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(email).toBeChecked({ checked: !checked });
  await refresh.click();
  await page
    .getByRole("alert", { name: "Refresh web app?", exact: true })
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  const reloaded = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await discard.getByRole("button", { name: "Discard changes", exact: true }).click();
  await reloaded;
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(email).toBeChecked({ checked });
});
