import { useAuth } from "@/auth/context";
import { ClientHealth } from "@/components/ClientHealth";
import { SystemOperations } from "@/components/SystemOperations";
import { PageHeader, PageScroll } from "@/components/ui";

export default function SystemHealthScreen() {
  const { user } = useAuth();
  return (
    <PageScroll>
      <PageHeader title="System Health" subtitle="Connections, sync activity, and recovery." />
      <ClientHealth />
      {user?.role === "owner" && <SystemOperations />}
    </PageScroll>
  );
}
