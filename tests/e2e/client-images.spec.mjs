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

test("client cards align identity, preview voice and center desktop create controls", async ({
  page,
  request,
}) => {
  await request.post("/__test/reset");
  const voice =
    "Warm and welcoming.\nClear, practical guidance.\nConfident without pressure.\nCommunity comes first.";
  await page.route("**/v1/clients", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: {
        ...json,
        data: json.data.map((c) => (c.id === "client-a" ? { ...c, brandVoice: voice } : c)),
      },
    });
  });
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  await page.goto("/clients");
  const card = page.getByRole("group", { name: "Client A client card", exact: true });
  const avatar = await card.getByLabel("Client A initials", { exact: true }).boundingBox();
  const name = await card
    .getByRole("link", { name: "Open Client A workspace", exact: true })
    .boundingBox();
  expect(Math.abs(avatar.y + avatar.height / 2 - name.y - name.height / 2)).toBeLessThan(2);
  const preview = card.getByLabel("Client A brand voice", { exact: true });
  await expect(preview).toHaveText(voice);
  expect((await preview.boundingBox()).height).toBeGreaterThanOrEqual(66);
  await expect(card.getByText("America/Indiana/Indianapolis", { exact: true })).toHaveCount(0);
  if (page.viewportSize().width >= 1024) {
    const bounds = await Promise.all(
      [
        page.getByLabel("Client name", { exact: true }),
        page.getByRole("button", { name: "Timezone", exact: true }),
        page.getByRole("button", { name: "Create client", exact: true }),
      ].map((control) => control.boundingBox()),
    );
    const centers = bounds.map((b) => b.y + b.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  }
});
