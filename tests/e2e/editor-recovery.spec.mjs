import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
});
async function headers(page) {
  return {
    authorization:
      "Bearer " + (await page.evaluate(() => sessionStorage.getItem("brandsparq_session"))),
  };
}
async function savedDeviceDraft(page, text) {
  await expect
    .poll(() =>
      page.evaluate((needle) => {
        for (const key of Object.keys(sessionStorage).filter((key) =>
          key.startsWith("brandsparq_editor_"),
        )) {
          try {
            const manifest = JSON.parse(sessionStorage.getItem(key));
            if (!Number.isInteger(manifest.count)) continue;
            const raw = Array.from(
              { length: manifest.count },
              (_, i) => sessionStorage.getItem(`${key}_${manifest.version}_${i}`) || "",
            ).join("");
            if (JSON.stringify(JSON.parse(raw).value).includes(needle)) return true;
          } catch {}
        }
        return false;
      }, text),
    )
    .toBe(true);
}

for (const item of [
  {
    name: "Brand Brain",
    route: "/clients/client-a/brand",
    field: "Brand voice",
    text: "Recovered local brand voice",
  },
  {
    name: "Campaign",
    route: "/campaigns/fixture-campaign",
    field: "Notes",
    text: "Recovered local campaign notes",
  },
  {
    name: "Post",
    route: "/posts/fixture-post",
    field: "Caption",
    text: "Recovered local caption #Wellness",
  },
  { name: "Settings", route: "/settings", field: "Minimum spacing (minutes)", text: "361" },
])
  test(`${item.name} restores a device draft after restart`, async ({ page }) => {
    await page.goto(item.route);
    const field = page.getByLabel(item.field, { exact: true });
    await expect(field).toBeEditable();
    await field.fill(item.text);
    await savedDeviceDraft(page, item.text);
    await page.reload();
    await expect(field).toHaveValue(item.text);
    await expect(
      page.getByText("Unsaved draft restored from this device.", { exact: true }),
    ).toBeVisible();
  });

test("a stale device draft shows latest server fields until explicitly restored", async ({
  page,
  request,
}) => {
  const auth = await headers(page);
  await page.goto("/clients/client-a/brand");
  const voice = page.getByLabel("Brand voice", { exact: true });
  await expect(voice).toBeEditable();
  await voice.fill("My older local voice");
  await savedDeviceDraft(page, "My older local voice");
  const before = (await (await request.get("/v1/clients/client-a/brand", { headers: auth })).json())
    .data;
  expect(
    (
      await request.post("/v1/clients/client-a/brand", {
        headers: auth,
        data: { voice: "Latest remote voice", expectedRevision: before.revision },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(voice).toHaveValue("Latest remote voice");
  await expect(voice).not.toBeEditable();
  await page.getByRole("button", { name: "Restore recovered draft", exact: true }).click();
  await expect(voice).toBeEditable();
  await expect(voice).toHaveValue("My older local voice");
});

test("approval can retry after caption save succeeds and approval fails", async ({
  page,
  request,
}) => {
  await page.goto("/posts/fixture-post");
  let approvals = 0;
  await page.route("**/v1/posts/fixture-post/approve", async (route) => {
    approvals++;
    if (approvals === 1)
      await route.fulfill({ status: 503, json: { error: "Temporary approval failure" } });
    else await route.continue();
  });
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Caption kept through approval retry");
  await page.getByRole("button", { name: "Approve post", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approval failed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(caption).toHaveValue("Caption kept through approval retry");
  await page.getByRole("button", { name: "Approve post", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approved", exact: true })).toBeVisible();
  const state = await (await request.post("/__test/state")).json();
  expect(state.post.status).toBe("calendar_scheduled");
  expect(state.post.caption).toBe("Caption kept through approval retry");
  expect(approvals).toBe(2);
});

test("a lost approval response is confirmed without submitting a second approval", async ({
  page,
  request,
}) => {
  await page.goto("/posts/fixture-post");
  let approvals = 0;
  await page.route("**/v1/posts/fixture-post/approve", async (route) => {
    approvals++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ status: 503, json: { error: "Approval response lost" } });
  });
  await page.getByRole("button", { name: "Approve post", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approved", exact: true })).toBeVisible();
  const state = await (await request.post("/__test/state")).json();
  expect(state.post.status).toBe("calendar_scheduled");
  expect(approvals).toBe(1);
});

test("public preview recovery preserves the unsaved caption and does not approve source photos", async ({
  page,
  request,
}) => {
  await request.post("/__test/source-preview");
  let fail = true;
  await page.route("**/v1/public/review/fixture-review/source-media*", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "Preview unavailable" });
    else await route.continue();
  });
  await page.goto("/review/fixture-review");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Keep this unsaved review caption");
  await expect(
    page.getByRole("button", { name: "Retry image preview", exact: true }),
  ).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "Retry image preview", exact: true }).click();
  const photo = page.getByRole("img", { name: "Source photo preview", exact: true });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  await expect(caption).toHaveValue("Keep this unsaved review caption");
  await expect(
    page.getByRole("button", { name: "Approve and add to calendar", exact: true }),
  ).toBeDisabled();
});

test("bottom tabs protect Create edits and discard restores the selected creation mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Create a social post", exact: true }).click();
  const home = page.getByRole("tab", { name: "Home", exact: true });
  await home.click();
  const prompt = page.getByRole("alert", { name: "Discard unsaved changes?", exact: true });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);
  await home.click();
  await prompt.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create a campaign", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
