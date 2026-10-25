import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import worker from "../cloudflare/src/index.ts";
import { imageUploadType, prominentColors } from "../src/shared/image-upload.ts";
import { zonedTime } from "../src/shared/zoned-time.ts";
const call = (w, path, body, method = "POST", user = "viewer") =>
  w.request(path, { method, user, body });
test("profile saves own name, verifies email once, and preserves Google identity", async (t) => {
  const w = workspace(t);
  w.exec("UPDATE users SET google_sub='viewer-sub' WHERE id='viewer'");
  assert.equal((await call(w, "/v1/profile", { name: "New Name" }, "PATCH")).status, 200);
  assert.equal(w.row("SELECT name FROM users WHERE id='viewer'").name, "New Name");
  let code;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("resend")) {
      code = JSON.stringify(JSON.parse(init.body)).match(/Your verification code is (\d{6})/)[1];
      return Response.json({ id: "email" });
    }
    if (String(url).includes("oauth2.googleapis.com/token"))
      return Response.json({ id_token: "id-token" });
    return Response.json({
      aud: w.env.GOOGLE_CLIENT_ID,
      iss: "https://accounts.google.com",
      sub: "viewer-sub",
      email: "viewer@example.test",
      email_verified: true,
      name: "Google Name",
    });
  });
  assert.equal(
    (await call(w, "/v1/profile/email/request", { email: "updated@example.test" })).status,
    200,
  );
  assert.equal(
    (await call(w, "/v1/profile/email/request", { email: "other@example.test" })).status,
    429,
  );
  assert.equal((await call(w, "/v1/profile/email/verify", { code: "wrong" })).status, 400);
  assert.equal((await call(w, "/v1/profile/email/verify", { code })).status, 200);
  assert.equal((await call(w, "/v1/profile/email/verify", { code })).status, 400);
  assert.equal(w.row("SELECT email FROM users WHERE id='viewer'").email, "updated@example.test");
  const start = await w.request("/v1/auth/google/start");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  assert.equal(
    (await w.request("/v1/auth/google/callback?state=" + state + "&code=fixture")).status,
    302,
  );
  assert.equal(w.row("SELECT name,email FROM users WHERE id='viewer'").name, "New Name");
  assert.equal(w.row("SELECT email FROM users WHERE id='viewer'").email, "updated@example.test");
});
test("deletion requires confirmation and protects sole owner while revoking member sessions", async (t) => {
  const w = workspace(t);
  assert.equal(
    (await call(w, "/v1/profile", { confirmation: "DELETE" }, "DELETE", "owner")).status,
    409,
  );
  assert.equal((await call(w, "/v1/profile", {}, "DELETE")).status, 400);
  assert.equal((await call(w, "/v1/profile", { confirmation: "DELETE" }, "DELETE")).status, 200);
  assert.equal(w.row("SELECT status FROM users WHERE id='viewer'").status, "removed");
  assert.equal((await w.request("/v1/auth/session", { user: "viewer" })).status, 401);
  assert.equal(
    w.row("SELECT email FROM users WHERE id='viewer'").email,
    "deleted-viewer@deleted.invalid",
  );
});
test("generic upload MIME accepts real PNG bytes and rejects non-image bytes", async (t) => {
  const w = workspace(t);
  const upload = (body) =>
    worker.fetch(
      new Request("https://brandsparq.getsparqd.com/v1/assets", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-token",
          "content-type": "application/octet-stream",
          "x-client-id": "client-a",
          "x-file-name": "photo.png",
        },
        body,
      }),
      w.env,
    );
  assert.equal((await upload(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).status, 201);
  assert.equal((await upload("not an image")).status, 415);
});
test("image hints and dominant colors ignore transparent pixels", () => {
  assert.equal(imageUploadType("application/octet-stream", "image/png"), "image/png");
  assert.deepEqual(
    prominentColors([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0], 4),
    ["#FF0000", "#0000FF"],
  );
  assert.deepEqual(prominentColors([128, 255, 128, 0], 2), ["#808080"]);
});
test("time picker values honor selected timezone and reject nonexistent DST times", () => {
  assert.equal(
    zonedTime("2026-10-24", "09:00", "America/Indiana/Indianapolis").toISOString(),
    "2026-10-24T13:00:00.000Z",
  );
  assert.equal(Number.isNaN(zonedTime("2026-03-08", "02:30", "America/New_York").getTime()), true);
});
