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

function roleOf(user: { role: string }): Role {
  const value = (user.role || "viewer").toLowerCase();
  return value in ROLE_PERMISSIONS ? (value as Role) : "viewer";
}

export function hasPermission(user: { role: string }, permission: Permission) {
  return ROLE_PERMISSIONS[roleOf(user)].has(permission);
}
