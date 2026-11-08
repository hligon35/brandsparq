import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { workspace } from "./workspace.mjs";
import worker from "../cloudflare/src/index.ts";
import { prominentColors } from "../src/shared/image-upload.ts";

const expected = ["#FF0000", "#0000FF", "#00FF00"];
function logo() {
  return encode({
    width: 4,
    height: 1,
    channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]),
  });
}
async function upload(w) {
  const response = await worker.fetch(
    new Request("https://brandsparq.getsparqd.com/v1/assets", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "x-client-id": "client-a",
        "content-type": "image/png",
        "x-file-name": "logo.png",
      },
      body: logo(),
    }),
    w.env,
  );
  assert.ok(response.ok);
  return (await response.json()).data;
}
const revision = (w) =>
  w.row("SELECT edit_revision FROM clients WHERE id='client-a'").edit_revision;
const profile = async (w) =>
  (await (await w.request("/v1/clients/client-a/brand", { user: "owner" })).json()).data;
const attach = (w, body) =>
  w.request("/v1/clients/client-a/brand-assets", { method: "POST", user: "owner", body });

test("logo palettes return three distinct colors without inventing colors for transparent or monochrome logos", () => {
  assert.deepEqual(
    prominentColors(
      [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 12, 13, 14, 0],
      4,
    ),
    expected,
  );
  assert.deepEqual(prominentColors([120, 120, 120, 255, 122, 122, 122, 255], 4), ["#797979"]);
  assert.deepEqual(prominentColors([255, 0, 0, 0], 4), []);
  assert.deepEqual(
    prominentColors([65535, 0, 0, 65535, 0, 0, 65535, 65535, 0, 65535, 0, 65535], 4, 16),
    expected,
  );
  assert.deepEqual(prominentColors([1, 2, 3], 0), []);
});

test("upload and deduplicated reupload return a server-extracted logo palette", async (t) => {
  const w = workspace(t);
  const first = await upload(w),
    second = await upload(w);
  assert.deepEqual(first.palette, expected);
  assert.deepEqual(second.palette, expected);
  assert.equal(first.id, second.id);
  assert.equal(second.deduplicated, true);
});

test("logo attachment saves three colors atomically, preserves brand copy, and fences stale attachments", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO brand_profiles(id,client_id,voice) VALUES ('brand','client-a','Keep this voice')",
  );
  const uploaded = await upload(w),
    initialRevision = revision(w);
  const result = await attach(w, {
    assetId: uploaded.id,
    role: "logo",
    expectedRevision: initialRevision,
    palette: uploaded.palette,
  });
  assert.equal(result.status, 200);
  const attached = await result.json(),
    saved = await profile(w);
  assert.equal(attached.revision, saved.revision);
  assert.deepEqual(attached.palette, expected);
  assert.equal(saved.voice, "Keep this voice");
  assert.equal(saved.logo_asset_id, uploaded.id);
  assert.deepEqual([saved.primary_color, saved.secondary_color, saved.tertiary_color], expected);
  assert.equal(
    (
      await attach(w, {
        assetId: uploaded.id,
        role: "alternate_logo",
        expectedRevision: initialRevision,
        palette: ["#FFFFFF"],
      })
    ).status,
    409,
  );
  assert.equal((await profile(w)).tertiary_color, "#00FF00");
  const patched = await w.request("/v1/clients/client-a/brand", {
    method: "POST",
    user: "owner",
    body: { expectedRevision: saved.revision, tertiaryColor: "#123456" },
  });
  assert.equal(patched.status, 200);
  assert.equal((await profile(w)).tertiary_color, "#123456");
  assert.equal(
    (
      await attach(w, {
        assetId: uploaded.id,
        role: "logo",
        expectedRevision: revision(w),
        palette: ["#FF0000"],
      })
    ).status,
    200,
  );
  const monochrome = await profile(w);
  assert.equal(monochrome.primary_color, "#FF0000");
  assert.equal(monochrome.secondary_color, null);
  assert.equal(monochrome.tertiary_color, null);
});

test("invalid palettes and unauthorized users cannot change a logo or palette; references do not recolor the brand", async (t) => {
  const w = workspace(t),
    uploaded = await upload(w);
  for (const palette of [["red"], ["#FFF"], [null], ["#000000", "#111111", "#222222", "#333333"]]) {
    assert.equal(
      (
        await attach(w, {
          assetId: uploaded.id,
          role: "logo",
          expectedRevision: revision(w),
          palette,
        })
      ).status,
      400,
    );
  }
  assert.equal(revision(w), 0);
  assert.equal(
    (
      await w.request("/v1/clients/client-a/brand-assets", {
        method: "POST",
        user: "viewer",
        body: { assetId: uploaded.id, role: "logo", expectedRevision: 0, palette: expected },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await attach(w, {
        assetId: uploaded.id,
        role: "reference",
        expectedRevision: 0,
        palette: expected,
      })
    ).status,
    200,
  );
  const saved = await profile(w);
  assert.equal(saved.primary_color, null);
  assert.equal(saved.tertiary_color, null);
});
