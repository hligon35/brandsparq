import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
// Writes are serialized per draft. A pointer is committed only after every chunk is saved.
const queues = new Map<string, Promise<void>>();
const read = async (key: string) =>
  Platform.OS === "web"
    ? typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(key)
    : SecureStore.getItemAsync(key);
const write = async (key: string, value: string) => {
  if (Platform.OS === "web") window.sessionStorage.setItem(key, value);
  else
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
};
const remove = async (key: string) => {
  if (Platform.OS === "web") window.sessionStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
};
export async function readDraft<T>(key: string): Promise<T | null> {
  await queues.get(key)?.catch(() => undefined);
  const pointer = await read(key);
  if (!pointer) return null;
  const manifest = JSON.parse(pointer);
  if (
    !Number.isInteger(manifest.count) ||
    manifest.count < 1 ||
    manifest.count > 500 ||
    !/^[a-z0-9_]+$/.test(manifest.version)
  )
    throw new Error("Saved draft is invalid.");
  const parts = await Promise.all(
    Array.from({ length: manifest.count }, (_, i) => read(`${key}_${manifest.version}_${i}`)),
  );
  if (parts.some((part) => part === null)) throw new Error("Saved draft is incomplete.");
  return JSON.parse(parts.join("")) as T;
}
export function saveDraft(key: string, value: unknown | null): Promise<void> {
  const operation = (queues.get(key) || Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const previous = await read(key);
      if (value === null) await remove(key);
      else {
        const serialized = JSON.stringify(value).replace(
            /[\u007f-\uffff]/g,
            (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
          ),
          version = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        const parts = serialized.match(/[\s\S]{1,350}/g) || ["null"];
        if (parts.length > 500) throw new Error("Draft is too large to save.");
        await Promise.all(parts.map((part, i) => write(`${key}_${version}_${i}`, part)));
        await write(key, JSON.stringify({ version, count: parts.length }));
      }
      if (previous) {
        const old = (() => {
          try {
            return JSON.parse(previous);
          } catch {
            return {};
          }
        })();
        if (
          Number.isInteger(old.count) &&
          old.count > 0 &&
          old.count <= 500 &&
          /^[a-z0-9_]+$/.test(old.version)
        )
          await Promise.all(
            Array.from({ length: old.count }, (_, i) => remove(`${key}_${old.version}_${i}`)),
          ).catch(() => undefined);
      }
    });
  queues.set(key, operation);
  return operation;
}
