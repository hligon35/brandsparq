import type { SessionUser } from "./auth";
import { hasPermission, type Permission } from "../../src/shared/permissions";
export { hasPermission, type Permission } from "../../src/shared/permissions";

export async function hasClientPermission(
  db: D1Database,
  user: SessionUser,
  permission: Permission,
  clientId: string,
) {
  if (user.role === "owner") return true;
  const row = await db
    .prepare("SELECT permission_role FROM user_client_access WHERE user_id=? AND client_id=?")
    .bind(user.id, clientId)
    .first<{ permission_role: string | null }>();
  return !!row && hasPermission({ role: row.permission_role || user.role }, permission);
}

export async function hasClientAccess(db: D1Database, user: SessionUser, clientId: string) {
  const role = user.role;
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
  const role = user.role;
  if (role === "owner") return null;

  const rows = await db
    .prepare("SELECT client_id FROM user_client_access WHERE user_id = ?")
    .bind(user.id)
    .all<{ client_id: string }>();

  return rows.results.map((row) => row.client_id);
}
