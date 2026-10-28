export function resolveApiOrigin(options: {
  configured?: string;
  platform: string;
  development: boolean;
  environment?: string;
  fixture?: boolean;
}) {
  const value = options.configured?.replace(/\/$/, "");
  if (options.fixture) {
    if (value !== "http://127.0.0.1:8788")
      throw new Error("Fixture API must be isolated loopback.");
    return value;
  }
  if (options.platform === "web" && !value && options.environment !== "staging") return "";
  if (!value) {
    if (options.environment === "staging") throw new Error("Staging API origin is required.");
    return "https://brandsparq.getsparqd.com";
  }
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Configure an API origin without credentials or paths.");
  if (
    options.environment === "staging" &&
    !/^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(value)
  )
    throw new Error("Staging requires its isolated HTTPS API.");
  if (
    !options.development &&
    (url.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(url.hostname))
  )
    throw new Error("Release API must use non-loopback HTTPS.");
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid API protocol.");
  return value;
}
