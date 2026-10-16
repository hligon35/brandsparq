import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

export default function CampaignDetailScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const [data, setData] = useState<any>();
  useEffect(() => {
    if (campaignId)
      api
        .getCampaign(campaignId)
        .then((r) => setData(r.data))
        .catch(() => {});
  }, [campaignId]);
  if (!data)
    return (
      <PageScroll>
        <Text style={styles.meta}>Loading campaign…</Text>
      </PageScroll>
    );
  return (
    <PageScroll>
      <PageHeader
        eyebrow={data.campaign.client_name || "Campaign"}
        title={data.campaign.name}
        subtitle={data.campaign.objective || "Campaign"}
        action={<StatusBadge label={data.campaign.status || "draft"} />}
      />
      <Card subtle>
        <Text style={styles.label}>Schedule</Text>
        <Text style={styles.value}>
          {data.campaign.starts_at || "No start"} → {data.campaign.ends_at || "No end"}
        </Text>
        {!!data.campaign.notes && <Text style={styles.meta}>{data.campaign.notes}</Text>}
      </Card>
      <View style={styles.list}>
        {data.posts.map((post: any) => (
          <Card key={post.id}>
            <View style={styles.row}>
              <StatusBadge label={post.status} />
              <Text style={styles.platform}>{String(post.platform).toUpperCase()}</Text>
            </View>
            <Text style={styles.title}>{post.title}</Text>
            <Text style={styles.meta}>{post.caption}</Text>
            <Text style={styles.time}>
              {post.scheduled_publish_at
                ? new Date(post.scheduled_publish_at).toLocaleString()
                : post.suggested_publish_at
                  ? `Suggested ${new Date(post.suggested_publish_at).toLocaleString()}`
                  : "Unscheduled"}
            </Text>
          </Card>
        ))}
      </View>
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  value: { color: colors.text, fontSize: 17, fontWeight: "900" },
  title: { color: colors.text, fontSize: 18, fontWeight: "900" },
  meta: { color: colors.muted, lineHeight: 21 },
  platform: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  time: { color: colors.primaryDark, fontWeight: "800", fontSize: 13 },
});
