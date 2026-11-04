import type { SessionUser } from "./auth";
import { hasPermission, type Permission } from "../../src/shared/permissions";
export { hasPermission, type Permission } from "../../src/shared/permissions";

export async function hasClientPermission(
  db: D1Database,
  user: SessionUser,
  permission: Permission,
  clientId: string,
) {
  if (await removedClient(db, clientId)) return false;
  if (user.role === "owner") return true;
  const row = await db
    .prepare("SELECT permission_role FROM user_client_access WHERE user_id=? AND client_id=?")
    .bind(user.id, clientId)
    .first<{ permission_role: string | null }>();
  return !!row && hasPermission({ role: row.permission_role || user.role }, permission);
}

export async function hasClientAccess(db: D1Database, user: SessionUser, clientId: string) {
  const role = user.role;
  if (await removedClient(db, clientId)) return false;
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
  if (role === "owner") {
    const removed = await db
      .prepare("SELECT id FROM clients WHERE status='removed' LIMIT 1")
      .first();
    if (!removed) return null;
    const rows = await db
      .prepare("SELECT id FROM clients WHERE status!='removed'")
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  const rows = await db
    .prepare(
      "SELECT a.client_id FROM user_client_access a JOIN clients c ON c.id=a.client_id WHERE a.user_id=? AND c.status!='removed'",
    )
    .bind(user.id)
    .all<{ client_id: string }>();

  return rows.results.map((row) => row.client_id);
}

async function removedClient(db: D1Database, id: string) {
  return !!(await db
    .prepare("SELECT id FROM clients WHERE id=? AND status='removed'")
    .bind(id)
    .first());
}
