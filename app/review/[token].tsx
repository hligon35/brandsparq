import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { BrandLogo } from "@/components/brand";
import {
  Button,
  Card,
  PageHeader,
  PageScroll,
  StatusBadge,
} from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

export default function PublicReviewScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [post, setPost] = useState<any>();
  const [working, setWorking] = useState(false);
  const [approved, setApproved] = useState(false);
  const { wide } = useResponsive();

  useEffect(() => {
    if (token) {
      api
        .getPublicReview(token)
        .then((result) => setPost(result.data))
        .catch((error) => {
          Alert.alert(
            "Review link unavailable",
            error instanceof Error
              ? error.message
              : "This review link is invalid."
          );
        });
    }
  }, [token]);

  async function approve() {
    if (!token) return;
    setWorking(true);

    try {
      await api.approvePublicReview(token);
      setApproved(true);
    } catch (error) {
      Alert.alert(
        "Approval failed",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll>
      <View style={styles.brand}>
        <BrandLogo compact />
      </View>

      {approved ? (
        <Card style={styles.approvedCard}>
          <View style={styles.approvedMark}>
            <Text style={styles.approvedCheck}>✓</Text>
          </View>
          <Text style={styles.approvedTitle}>Approved</Text>
          <Text style={styles.sub}>
            This post has been added to the official marketing calendar.
          </Text>
        </Card>
      ) : post ? (
        <>
          <PageHeader
            eyebrow="Review request"
            title={post.client_name}
            subtitle={String(post.platform).toUpperCase()}
            action={<StatusBadge label={post.status} />}
          />

          <View style={[styles.grid, wide && styles.gridWide]}>
            <Card style={styles.mediaCard}>
              {post.image_url ? (
                <Image
                  source={{ uri: post.image_url }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.previewWrap}>
                  <Text style={styles.preview}>
                    GRAPHIC GENERATION PENDING
                  </Text>
                </View>
              )}
            </Card>

            <View style={styles.copyColumn}>
              <Card>
                <Text style={styles.heading}>
                  {post.headline || post.title}
                </Text>
                <Text style={styles.sub}>{post.caption}</Text>
              </Card>

              <Card subtle>
                <Text style={styles.label}>
                  Suggested publish time
                </Text>
                <Text style={styles.heading}>
                  {post.suggested_publish_at
                    ? new Date(
                        post.suggested_publish_at
                      ).toLocaleString()
                    : "Not selected"}
                </Text>
              </Card>

              <Button
                label={
                  working
                    ? "Approving…"
                    : "Approve and add to calendar"
                }
                onPress={working ? undefined : approve}
              />
            </View>
          </View>
        </>
      ) : (
        <Card subtle>
          <Text style={styles.sub}>Loading review…</Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  brand: {
    marginBottom: spacing.sm,
  },
  grid: {
    gap: spacing.md,
  },
  gridWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  mediaCard: {
    flex: 1.05,
    padding: 10,
  },
  copyColumn: {
    flex: 0.95,
    minWidth: 0,
    gap: spacing.md,
  },
  image: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  previewWrap: {
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "800",
  },
  heading: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "900",
  },
  sub: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  approvedCard: {
    maxWidth: 620,
    alignSelf: "center",
    width: "100%",
    alignItems: "center",
    paddingVertical: 50,
  },
  approvedMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#E7F8F1",
    alignItems: "center",
    justifyContent: "center",
  },
  approvedCheck: {
    color: colors.success,
    fontSize: 30,
    fontWeight: "900",
  },
  approvedTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
});
