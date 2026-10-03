export interface SecurityEnv {
  SOCIAL_TOKEN_KEY?: string;
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
