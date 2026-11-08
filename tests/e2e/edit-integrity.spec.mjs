import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
async function signIn(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible({
    timeout: 10000,
  });
  return {
    authorization:
      "Bearer " + (await page.evaluate(() => sessionStorage.getItem("brandsparq_session"))),
  };
}
test("review shows the source image and saves caption edits when graphic generation failed", async ({
  page,
  request,
}) => {
  await request.post("/__test/source-preview");
  await signIn(page);
  await page.goto("/posts/fixture-post");
  const photo = page.getByRole("img", { name: "Source photo preview", exact: true });
  await expect(photo).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve post", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Final artwork is missing" }),
  ).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Caption corrected from review #Wellness");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/v1/posts/fixture-post/edit") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Save copy", exact: true })).toBeVisible();
  await page.reload();
  await expect(caption).toHaveValue("Caption corrected from review #Wellness");
  const state = await (await request.post("/__test/state")).json();
  expect(state.post.graphic_key).toBeNull();
  expect(state.post.status).toBe("awaiting_approval");
});

test("scheduled posts retain image, editable caption and their scheduled time", async ({
  page,
  request,
}) => {
  await page.goto("/review/fixture-review");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(
    page.getByText("This post has been added to the official marketing calendar."),
  ).toBeVisible();
  const before = await (await request.post("/__test/state")).json();
  await signIn(page);
  await page.goto("/posts/fixture-post");
  await expect(page.getByRole("img", { name: "Post image", exact: true })).toBeVisible();
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("Updated scheduled caption");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/v1/posts/fixture-post/edit") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(caption).toHaveValue("Updated scheduled caption");
  const after = await (await request.post("/__test/state")).json();
  expect(after.post.scheduled_publish_at).toBe(before.post.scheduled_publish_at);
  expect(after.post.status).toBe(before.post.status);
});
test("stale Brand Brain edits remain visible and reload requires explicit discard", async ({
  page,
  request,
}) => {
  const headers = await signIn(page);
  await page.goto("/clients/client-a/brand");
  const voice = page.getByLabel("Brand voice", { exact: true });
  await expect(voice).toBeEditable();
  await voice.fill("My unsaved local voice");
  const snapshot = (await (await request.get("/v1/clients/client-a/brand", { headers })).json())
    .data;
  expect(
    (
      await request.post("/v1/clients/client-a/brand", {
        headers,
        data: { expectedRevision: snapshot.revision, voice: "Saved by another editor" },
      })
    ).status(),
  ).toBe(200);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/v1/clients/client-a/brand") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save Brand Brain", exact: true }).click();
  expect((await response).status()).toBe(409);
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(voice).toHaveValue("My unsaved local voice");
  await page.getByRole("button", { name: "Reload latest", exact: true }).click();
  const confirmation = page.getByRole("alert", {
    name: "Reload latest saved version?",
    exact: true,
  });
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(voice).toHaveValue("My unsaved local voice");
  await page.getByRole("button", { name: "Reload latest", exact: true }).click();
  await confirmation.getByRole("button", { name: "Reload latest", exact: true }).click();
  await expect(voice).toHaveValue("Saved by another editor");
});
test("an older post editor cannot approve or replace newer saved copy", async ({
  page,
  request,
}) => {
  const headers = await signIn(page);
  await page.goto("/posts/fixture-post");
  const caption = page.getByLabel("Caption", { exact: true });
  await expect(caption).toBeEditable();
  await caption.fill("My unsaved caption");
  const snapshot = (await (await request.get("/v1/posts/fixture-post", { headers })).json()).data;
  expect(
    (
      await request.post("/v1/posts/fixture-post/edit", {
        headers,
        data: { expectedRevision: snapshot.content_revision, caption: "Newer saved caption" },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Approve post", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Approval failed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(caption).toHaveValue("My unsaved caption");
  const current = (await (await request.get("/v1/posts/fixture-post", { headers })).json()).data;
  expect(current.status).toBe("awaiting_approval");
  expect(current.caption).toBe("Newer saved caption");
});
