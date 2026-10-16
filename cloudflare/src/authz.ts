import type { SessionUser } from "./auth";

export type Permission =
  | "read"
  | "generate"
  | "upload"
  | "brand_manage"
  | "review"
  | "ai_edit"
  | "publish"
  | "calendar_manage"
  | "client_manage"
  | "social_manage"
  | "settings_manage"
  | "analytics_manage"
  | "notifications_manage"
  | "system_manage";

type Role = "owner" | "admin" | "reviewer" | "publisher" | "viewer";

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: new Set<Permission>([
    "read",
    "generate",
    "upload",
    "brand_manage",
    "review",
    "ai_edit",
    "publish",
    "calendar_manage",
    "client_manage",
    "social_manage",
    "settings_manage",
    "analytics_manage",
    "notifications_manage",
    "system_manage",
  ]),
  admin: new Set<Permission>([
    "read",
    "generate",
    "upload",
    "brand_manage",
    "review",
    "ai_edit",
    "publish",
    "calendar_manage",
    "client_manage",
    "social_manage",
    "analytics_manage",
    "notifications_manage",
  ]),
  reviewer: new Set<Permission>(["read", "review", "ai_edit"]),
  publisher: new Set<Permission>(["read", "publish", "calendar_manage"]),
  viewer: new Set<Permission>(["read"]),
};

function roleOf(user: SessionUser): Role {
  const value = (user.role || "viewer").toLowerCase();
  return value in ROLE_PERMISSIONS ? (value as Role) : "viewer";
}

export function hasPermission(user: SessionUser, permission: Permission) {
  return ROLE_PERMISSIONS[roleOf(user)].has(permission);
}

export async function hasClientAccess(db: D1Database, user: SessionUser, clientId: string) {
  const role = roleOf(user);
  if (role === "owner") return true;

  const row = await db
    .prepare("SELECT 1 AS allowed FROM user_client_access WHERE user_id = ? AND client_id = ?")
    .bind(user.id, clientId)
    .first<{ allowed: number }>();

  return !!row?.allowed;
}

export async function accessibleClientIds(
  db: D1Database,
  user: SessionUser,
): Promise<string[] | null> {
  const role = roleOf(user);
  if (role === "owner") return null;

  const rows = await db
    .prepare("SELECT client_id FROM user_client_access WHERE user_id = ?")
    .bind(user.id)
    .all<{ client_id: string }>();

  return rows.results.map((row) => row.client_id);
}
