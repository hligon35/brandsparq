import { test, expect } from "@playwright/test";

test("client cards load connected profile images and fall back to initials on image failure", async ({
  page,
  request,
}) => {
  await request.post("/__test/reset");
  await request.post("/__test/client-photo");
  const { encode } = await import("fast-png");
  const bytes = Buffer.from(
    encode({ width: 1, height: 1, data: new Uint8Array([80, 120, 200, 255]), channels: 4 }),
  );
  let authorization;
  await page.route("https://images.example.test/client-a.png", async (route) => {
    authorization = route.request().headers().authorization;
    await route.fulfill({ contentType: "image/png", body: bytes });
  });
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
  await page.goto("/clients");
  const photo = page.getByRole("img", { name: "Client A account profile image", exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((image) => image.naturalWidth)).toBe(1);
  expect(authorization).toBeUndefined();
  await expect(page.getByLabel("Client B initials", { exact: true })).toBeVisible();
  await page.unroute("https://images.example.test/client-a.png");
  await page.route("https://images.example.test/client-a.png", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.reload();
  await expect(page.getByLabel("Client A initials", { exact: true })).toBeVisible();
});
