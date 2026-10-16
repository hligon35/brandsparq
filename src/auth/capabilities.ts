import { useAuth, type AuthUser } from "./context";
import { hasPermission, type Permission } from "@/shared/permissions";
export function can(user: AuthUser | null, permission: Permission, clientId?: string) {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (clientId)
    return (
      !!user.clientRoles?.[clientId] &&
      hasPermission({ role: user.clientRoles[clientId] }, permission)
    );
  return (
    hasPermission(user, permission) ||
    Object.values(user.clientRoles || {}).some((role) => hasPermission({ role }, permission))
  );
}
export function useCapabilities() {
  const { user } = useAuth();
  return (permission: Permission, clientId?: string) => can(user, permission, clientId);
}
