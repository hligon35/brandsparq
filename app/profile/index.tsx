import { useAuth } from "@/auth/context";
import { Card, PageHeader, PageScroll } from "@/components/ui";
import { Text } from "react-native";
import { colors } from "@/theme/tokens";
export default function ProfileScreen() {
  const { user } = useAuth();
  return (
    <PageScroll>
      <PageHeader title="Profile" subtitle="Your signed-in account" />
      <Card>
        {[
          ["Name", user?.name || "Not provided"],
          ["Email", user?.email],
          ["Workspace role", user?.role],
        ].map(([label, value]) => (
          <Text key={label} style={{ color: colors.text, fontSize: 16, lineHeight: 26 }}>
            {label}: {value}
          </Text>
        ))}
      </Card>
    </PageScroll>
  );
}
