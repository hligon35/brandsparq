import { test, expect } from "@playwright/test";
const image = {
  name: "creation.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh18AAAAASUVORK5CYII=",
    "base64",
  ),
};
test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  page.on("dialog", (dialog) => dialog.accept());
});
async function prepare(page) {
  await page.goto("/login?handoff=fixture-handoff");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.goto("/create");
  await page.getByRole("button", { name: "Create a social post", exact: true }).click();
  await page.getByRole("button", { name: "facebook · Test Facebook Page", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose images", exact: true }).click();
  await (await chooser).setFiles(image);
  await expect(
    page.getByRole("button", { name: "Remove creation.png", exact: true }),
  ).toBeVisible();
}
test("failed derivative retry retains the original image upload", async ({ page, request }) => {
  await prepare(page);
  let originals = 0,
    derivatives = 0;
  await page.route("**/v1/assets", async (route) => {
    originals++;
    await route.continue();
  });
  await page.route("**/v1/assets/*/derivative", async (route) => {
    derivatives++;
    if (derivatives === 1)
      await route.fulfill({ status: 503, json: { error: "Fixture derivative unavailable" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Create social post", exact: true }).click();
  await page.getByRole("button", { name: "Close message", exact: true }).click();
  await expect(page.getByText("Fixture derivative unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry failed uploads", exact: true }).click();
  await expect(page).toHaveURL(/generation\?jobId=/);
  expect(originals).toBe(1);
  expect(derivatives).toBe(2);
  expect(
    (await (await request.post("/__test/state")).json()).generationJobs.filter(
      (job) => job.creation_options,
    ),
  ).toHaveLength(1);
});
test("discarding during upload prevents late creation and does not poison the next request", async ({
  page,
  request,
}) => {
  await prepare(page);
  let release, started;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    began = new Promise((resolve) => {
      started = resolve;
    });
  let derivatives = 0;
  await page.route("**/v1/assets/*/derivative", async (route) => {
    if (++derivatives === 1) {
      started();
      await gate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Create social post", exact: true }).click();
  await began;
  await expect(
    page.getByRole("button", { name: "Select client: Client A", exact: true }),
  ).toBeDisabled();
  const brand = page.getByRole("link", { name: "Open Brand Brain", exact: true });
  await brand.click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page).toHaveURL(/clients\/client-a\/brand$/);
  const finished = page.waitForResponse((response) => response.url().endsWith("/derivative"));
  release();
  await (await finished).finished();
  expect(
    (await (await request.post("/__test/state")).json()).generationJobs.filter(
      (job) => job.creation_options,
    ),
  ).toHaveLength(0);
  await page.goto("/create");
  await page.getByRole("button", { name: "Create a social post", exact: true }).click();
  await page.getByRole("button", { name: "facebook · Test Facebook Page", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose images", exact: true }).click();
  await (await chooser).setFiles(image);
  await page.getByRole("button", { name: "Announce", exact: true }).click();
  await page.getByRole("button", { name: "Create social post", exact: true }).click();
  await expect(page).toHaveURL(/generation\?jobId=/);
  const jobs = (await (await request.post("/__test/state")).json()).generationJobs.filter(
    (job) => job.creation_options,
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].objective).toBe("Announce");
});
