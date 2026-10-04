export interface SecurityEnv {
  SOCIAL_TOKEN_KEY?: string;
  AUTH_PEPPER?: string;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptionKey(env: SecurityEnv) {
  if (!env.SOCIAL_TOKEN_KEY) {
    throw new Error("SOCIAL_TOKEN_KEY is not configured.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(env.SOCIAL_TOKEN_KEY)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(
  value: string | null | undefined,
  env: SecurityEnv
): Promise<string | null> {
  if (!value) return null;
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value)
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(
  payload: string | null | undefined,
  env: SecurityEnv
): Promise<string | null> {
  if (!payload) return null;
  const [version, iv64, cipher64] = payload.split(".");
  if (version !== "v1" || !iv64 || !cipher64) {
    throw new Error("Unsupported encrypted secret format.");
  }
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv64) },
    key,
    base64ToBytes(cipher64)
  );
  return new TextDecoder().decode(plain);
}

export async function hashSecret(value: string, pepper = "") {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${pepper}:${value}`)
  );
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}


function base64UrlEncode(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return base64ToBytes(padded);
}

async function mediaSigningKey(env: SecurityEnv) {
  if (!env.AUTH_PEPPER) throw new Error("AUTH_PEPPER is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AUTH_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSignedMediaToken(
  r2Key: string,
  env: SecurityEnv,
  ttlMs = 15 * 60 * 1000
) {
  const payload = base64UrlEncode(JSON.stringify({ key: r2Key, expiresAt: Date.now() + ttlMs }));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await mediaSigningKey(env),
    new TextEncoder().encode(payload)
  );
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySignedMediaToken(token: string, env: SecurityEnv) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await mediaSigningKey(env),
    base64UrlDecode(signature),
    new TextEncoder().encode(payload)
  );
  if (!valid) return null;

  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as {
      key?: string;
      expiresAt?: number;
    };
    if (!decoded.key || !decoded.expiresAt || decoded.expiresAt <= Date.now()) return null;
    return { key: decoded.key, expiresAt: decoded.expiresAt };
  } catch {
    return null;
  }
}
