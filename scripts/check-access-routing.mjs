// No Access service token: providers and native clients must reach these routes.
const value = process.env.BRANDSPARQ_BASE_URL;
if (!value) throw new Error("Set BRANDSPARQ_BASE_URL explicitly.");
const base = new URL(value);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== "/"
)
  throw new Error("Use an HTTPS origin.");
for (const [path, status] of [
  ["/v1/dashboard", 401],
  ["/v1/public/review/invalid-acceptance-token", 404],
  ["/v1/public/invitations/invalid-acceptance-token", 404],
  ["/v1/public/publish-media/invalid-acceptance-token", 404],
]) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (
    response.status !== status ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      `${path}: expected Worker JSON ${status}; received ${response.status}. Check Access routing.`,
    );
  console.log(`PASS ${path}: application guard reached without Access credentials`);
}
