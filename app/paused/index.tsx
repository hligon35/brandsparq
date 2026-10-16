import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
export default function PausedScreen() {
  const can = useCapabilities();
  const [posts, setPosts] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState("");
  async function load() {
    try {
      setPosts((await api.getPausedPosts()).data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load paused posts.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(id: string, action: "resume" | "restore-review" | "cancel") {
    setWorking(id);
    try {
      await api.pausedAction(id, action);
      await load();
    } catch (e) {
      Alert.alert("Unable to update post", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking("");
    }
  }
  return (
    <PageScroll>
      <PageHeader
        title="Paused content"
        eyebrow="Calendar recovery"
        subtitle="Resume approved content at a new valid slot, or return unfinished content to review."
        action={<Button label="Refresh" small onPress={load} />}
      />
      {!!error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      )}
      {!loaded ? (
        <Text style={styles.text}>Loading paused content…</Text>
      ) : !posts.length ? (
        <Text style={styles.text}>No paused posts.</Text>
      ) : (
        posts.map((post) => (
          <Card key={post.id}>
            <Text style={styles.text}>
              {post.client_name} · {post.platform}
            </Text>
            <Text style={styles.text}>{post.title}</Text>
            {post.client_status === "archived" ? (
              <Text style={styles.text}>Restore this client before resuming work.</Text>
            ) : (
              <View style={styles.row}>
                {post.approved_at
                  ? can("calendar_manage", post.client_id) && (
                      <Button
                        label="Resume at next slot"
                        onPress={working ? undefined : () => act(post.id, "resume")}
                      />
                    )
                  : can("review", post.client_id) && (
                      <Button
                        label="Return to review"
                        onPress={working ? undefined : () => act(post.id, "restore-review")}
                      />
                    )}{" "}
                {can("calendar_manage", post.client_id) && (
                  <Button
                    label="Cancel post"
                    secondary
                    onPress={working ? undefined : () => act(post.id, "cancel")}
                  />
                )}
              </View>
            )}
            <Link href={`/posts/${post.id}`} asChild>
              <Button label="Open post" secondary />
            </Link>
          </Card>
        ))
      )}
    </PageScroll>
  );
}
