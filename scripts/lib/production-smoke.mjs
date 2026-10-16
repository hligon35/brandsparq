export async function runProductionSmoke({
  env = process.env,
  fetcher = fetch,
  log = console,
} = {}) {
  const base = (env.BRANDSPARQ_BASE_URL || "https://brandsparq.getsparqd.com").replace(/\/$/, "");
  const target = new URL(base);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/"
  )
    throw new Error(
      "BRANDSPARQ_BASE_URL must be an HTTPS origin without credentials, query or path.",
    );
  const accessId = env.CF_ACCESS_CLIENT_ID || "";
  const accessSecret = env.CF_ACCESS_CLIENT_SECRET || "";
  if (!!accessId !== !!accessSecret)
    throw new Error(
      "Set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET for Cloudflare Access authentication.",
    );
  const failures = [];
  const pass = (name) => log.log("PASS:", name);
  const fail = (name, detail) => {
    failures.push(`${name}: ${detail}`);
    log.error("FAIL:", name, detail);
  };

  async function request(name, url, options = {}, validate) {
    try {
      const headers = new Headers(options.headers);
      if (accessId) {
        headers.set("CF-Access-Client-Id", accessId);
        headers.set("CF-Access-Client-Secret", accessSecret);
      }
      // Never forward service credentials through redirects to Google or Access.
      const response = await fetcher(url, {
        ...options,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      const location = response.headers.get("location") || "";
      const accessChallenge =
        /cloudflare-access/i.test(response.headers.get("www-authenticate") || "") ||
        /\.cloudflareaccess\.com(?:\/|$)|\/cdn-cgi\/access\//i.test(location);
      const html = (response.headers.get("content-type") || "").includes("text/html")
        ? await response.clone().text()
        : "";
      if (
        accessChallenge ||
        /cloudflare access|\.cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(html)
      ) {
        fail(
          name,
          "Cloudflare Access blocked the smoke test before the Worker. Configure CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET with an authorized Service Auth policy.",
        );
        return;
      }
      const result = await validate(response);
      if (result === true) pass(name);
      else fail(name, String(result || `HTTP ${response.status}`));
    } catch (error) {
      fail(name, error instanceof Error ? error.message : String(error));
    }
  }

  await request(
    "health",
    `${base}/health`,
    { headers: { accept: "application/json" } },
    async (response) => {
      if (response.status !== 200) return `HTTP ${response.status}`;
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) return "Health payload is not OK.";
      if (payload?.checks?.some?.((check) => typeof check.detail === "string"))
        return "Public health leaks detailed diagnostics.";
      return true;
    },
  );

  await request(
    "login SPA",
    `${base}/login`,
    { headers: { accept: "text/html" } },
    async (response) => {
      if (!response.ok) return `HTTP ${response.status}`;
      const body = await response.text();
      return (
        (/<html/i.test(body) && /BrandSparQ|_expo/i.test(body)) ||
        "Login route did not return the Expo web app."
      );
    },
  );

  const returnTo = encodeURIComponent(`${base}/login`);
  await request(
    "Google OAuth start",
    `${base}/v1/auth/google/start?return_to=${returnTo}`,
    { redirect: "manual" },
    async (response) => {
      if (![301, 302, 303, 307, 308].includes(response.status))
        return `Expected OAuth redirect, got HTTP ${response.status}`;
      const location = response.headers.get("location") || "";
      return (
        /^https:\/\/accounts\.google\.com\//.test(location) || "OAuth did not redirect to Google."
      );
    },
  );

  await request(
    "API auth guard",
    `${base}/v1/dashboard`,
    { headers: { accept: "application/json" } },
    async (response) => {
      if (response.status !== 401)
        return `Expected 401 without a session, got HTTP ${response.status}`;
      const payload = await response.json().catch(() => null);
      return (
        typeof payload?.error === "string" || "Auth guard did not return the Worker JSON error."
      );
    },
  );

  if (failures.length) {
    log.error("\nProduction smoke test FAILED:");
    for (const item of failures) log.error(" -", item);
  } else log.log("\nBrandSparQ production smoke test passed.");
  return failures;
}
