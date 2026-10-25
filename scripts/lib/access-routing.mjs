export async function checkAccessRouting({ origin, fetcher = fetch }) {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("Use an HTTPS origin without credentials, path or query.");
  const probes = [
    { path: "/v1/dashboard", status: 401 },
    { path: "/v1/public/review/invalid-acceptance-token", status: 404 },
    { path: "/v1/public/invitations/invalid-acceptance-token", status: 404 },
    { path: "/v1/public/publish-media/invalid-acceptance-token", status: 404 },
    { path: "/v1/auth/google/callback?state=invalid-acceptance-state&code=invalid", status: 400 },
    ...["meta", "linkedin", "tiktok", "x"].map((provider) => ({
      path: `/v1/social/${provider}/callback?state=invalid-acceptance-state`,
      status: 400,
    })),
    {
      path: "/v1/social/webhooks/meta?hub.mode=subscribe&hub.verify_token=invalid-acceptance-token&hub.challenge=probe",
      status: 403,
      text: "Forbidden",
    },
    {
      path: "/v1/social/webhooks/meta",
      method: "POST",
      body: "{}",
      status: 401,
      text: "Invalid signature",
    },
  ];
  const checks = [];
  for (const probe of probes) {
    try {
      const response = await fetcher(new URL(probe.path, base), {
        method: probe.method || "GET",
        ...(probe.body
          ? { body: probe.body, headers: { "content-type": "application/json" } }
          : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.text();
      const type = response.headers.get("content-type") || "";
      const workerBody = probe.text
        ? body === probe.text
        : type.includes("application/json") && typeof JSON.parse(body).error === "string";
      checks.push({
        path: probe.path.split("?")[0],
        method: probe.method || "GET",
        expected: probe.status,
        status: response.status,
        passed: response.status === probe.status && workerBody,
      });
    } catch (error) {
      checks.push({
        path: probe.path.split("?")[0],
        method: probe.method || "GET",
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    origin: base.origin,
    checkedAt: new Date().toISOString(),
    anonymous: true,
    passed: checks.every((check) => check.passed),
    checks,
  };
}
