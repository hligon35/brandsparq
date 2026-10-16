const value = process.env.BRANDSPARQ_BASE_URL;
if (!value)
  throw new Error(
    "Set BRANDSPARQ_BASE_URL to the deployed staging origin; staging smoke never defaults to production.",
  );
const url = new URL(value);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  (url.pathname !== "/" && url.pathname !== "")
) {
  throw new Error(
    "BRANDSPARQ_BASE_URL must be an HTTPS origin without credentials, query or path.",
  );
}
if (url.hostname === "brandsparq.getsparqd.com")
  throw new Error("Use smoke:production for the production domain.");
await import("./smoke-production.mjs");
