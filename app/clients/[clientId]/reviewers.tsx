import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { Field, formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
export default function ReviewersScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const can = useCapabilities();
  const manage = can("client_manage", clientId);
  const review = can("review", clientId);
  const [people, setPeople] = useState<any[]>([]);
  const [links, setLinks] = useState<{ tokens: any[]; deliveries: any[] }>({
    tokens: [],
    deliveries: [],
  });
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function load() {
    try {
      const [r, l] = await Promise.all([
        api.getReviewers(clientId),
        review
          ? api.getReviewLinks(clientId)
          : Promise.resolve({ data: { tokens: [], deliveries: [] } }),
      ]);
      setPeople(r.data);
      setLinks(l.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load reviewers.");
    }
  }
  useEffect(() => {
    void load();
  }, [clientId]);
  async function act(action: () => Promise<unknown>, message?: string) {
    setWorking(true);
    try {
      await action();
      await load();
      if (message) Alert.alert(message);
    } catch (e) {
      Alert.alert("Review update failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <PageScroll>
      <PageHeader
        title="Client reviewers"
        eyebrow="Review delivery"
        subtitle="Configure who receives secure review links and track delivery."
      />
      {!!error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      )}
      <Card>
        <Text style={styles.text}>
          With no configured reviewers, review email uses the workspace recipient. Disabling a
          reviewer revokes their existing links.
        </Text>
        {manage && (
          <>
            <Field label="Reviewer email" value={email} onChange={setEmail} />
            <Button
              label="Add reviewer"
              onPress={
                working || !email.trim()
                  ? undefined
                  : () =>
                      act(async () => {
                        await api.saveReviewer(clientId, email);
                        setEmail("");
                      })
              }
            />
          </>
        )}
        {people.map((p) => (
          <View key={p.id} style={styles.row}>
            <Text style={styles.text}>{p.email}</Text>
            <StatusBadge label={p.enabled ? "enabled" : "disabled"} />
            {manage && (
              <Button
                label={p.enabled ? "Disable reviewer" : "Enable reviewer"}
                small
                secondary
                onPress={
                  working
                    ? undefined
                    : () => act(() => api.saveReviewer(clientId, p.email, !p.enabled))
                }
              />
            )}
          </View>
        ))}
      </Card>
      {review && (
        <>
          <Card>
            <Button
              label="Send review links"
              onPress={
                working
                  ? undefined
                  : () =>
                      act(async () => {
                        const r = await api.reviewLinksAction(clientId);
                        Alert.alert(
                          "Review delivery",
                          `${r.data?.sent || 0} email(s) sent; ${r.data?.failed || 0} failed.`,
                        );
                      })
              }
            />
            <Text style={styles.text}>
              Sends current review posts to enabled reviewers and replaces their older links. No
              posts are approved by sending an email.
            </Text>
            {links.deliveries.map((d) => (
              <View key={d.id}>
                <Text style={styles.text}>
                  {d.recipient_email} · {d.status}
                </Text>
                {!!d.error_message && <Text style={styles.error}>{d.error_message}</Text>}
              </View>
            ))}
          </Card>
          <Card>
            <Text style={styles.text}>Review links</Text>
            {!links.tokens.length && <Text style={styles.text}>No review links yet.</Text>}
            {links.tokens.map((t) => (
              <View key={t.id}>
                <Text style={styles.text}>
                  {t.title} · {t.recipient_email}
                </Text>
                <Text style={styles.text}>
                  {t.revoked_at
                    ? "Revoked"
                    : t.expires_at <= Date.now()
                      ? "Expired"
                      : t.used_at
                        ? "Approved"
                        : "Active"}
                </Text>
                {!t.revoked_at && t.expires_at > Date.now() && (
                  <Button
                    label="Revoke link"
                    small
                    secondary
                    onPress={
                      working
                        ? undefined
                        : () =>
                            act(() =>
                              api.reviewLinksAction(clientId, { action: "revoke", tokenId: t.id }),
                            )
                    }
                  />
                )}
              </View>
            ))}
          </Card>
        </>
      )}
    </PageScroll>
  );
}
