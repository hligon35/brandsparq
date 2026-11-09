import { refreshPages } from "@/shared/refresh-pages";
import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EssentialRow, essentialStyles } from "@/components/essential";
import { IconButton } from "@/components/icon-button";
import { Link } from "expo-router";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert, confirmAction } from "@/components/feedback";
import { formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageList } from "@/components/ui";
export default function PausedScreen() {
  const can = useCapabilities();
  const [posts, setPosts] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query);
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);
  const visibleCount = useRef(0);
  async function load(more = false, isCurrent = refresh.active) {
    setLoading(true);
    const version = ++loadVersion.current;
    try {
      let result = await api.getPausedPosts({
        search,
        ...(more && nextCursor ? { cursor: nextCursor } : {}),
      });
      if (!more)
        result = await refreshPages(result, visibleCount.current, (cursor) => {
          if (!isCurrent()) throw new Error("Refresh canceled");
          return api.getPausedPosts({ search, cursor });
        });
      if (version !== loadVersion.current || !isCurrent()) return;
      setPosts((old) => {
        const rows = more
          ? [...new Map([...old, ...result.data].map((row) => [row.id, row])).values()]
          : result.data;
        visibleCount.current = rows.length;
        return rows;
      });
      setNextCursor(result.nextCursor);
      setError("");
    } catch (e) {
      if (version !== loadVersion.current || !isCurrent()) return;
      setError(e instanceof Error ? e.message : "Unable to load paused posts.");
    } finally {
      if (version === loadVersion.current && isCurrent()) {
        setLoaded(true);
        setLoading(false);
      }
    }
  }
  const refresh = useFocusedRefresh((context) => load(false, context.current), [search]);
  async function act(id: string, action: "resume" | "restore-review" | "cancel") {
    const post = posts.find((item) => item.id === id);
    if (
      action === "cancel" &&
      !(await confirmAction(
        "Cancel paused post?",
        `Cancel “${post?.title || "this post"}” for ${post?.client_name || "this client"}? It will no longer be available to resume.`,
        "Cancel post",
        "Keep post",
      ))
    )
      return;
    setWorking(id);
    try {
      await api.pausedAction(id, action);
      await refresh();
    } catch (e) {
      Alert.alert("Unable to update post", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking("");
    }
  }
  return (
    <PageList
      data={posts}
      keyExtractor={(post) => post.id}
      extraData={working}
      refreshing={loading}
      onRefresh={refresh}
      header={
        <>
          <PageHeader
            title="Paused content"
            subtitle="Resume approved work or return it to review."
            action={<IconButton label="Refresh paused content" onPress={() => void refresh()} />}
          />
          <TextInput
            accessibilityLabel="Search paused content"
            placeholder="Search client or title"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setNextCursor(null);
            }}
            onSubmitEditing={() => void refresh()}
            style={essentialStyles.input}
          />
          <Button label="Search" onPress={() => void refresh()} />
          {!!error && (
            <Card>
              <Text style={styles.error}>{error}</Text>
              <Button label="Try again" onPress={() => void refresh()} />
            </Card>
          )}
        </>
      }
      renderItem={({ item: post }) => (
        <Card>
          <EssentialRow key={post.id} title={post.title || "Paused post"}>
            <Text style={styles.text}>
              {post.client_name} · {post.platform}
            </Text>

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
                    )}
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
          </EssentialRow>
        </Card>
      )}
      empty={
        <Text style={styles.text}>{loaded ? "No paused posts." : "Loading paused content…"}</Text>
      }
      footer={
        <>
          {!!nextCursor && (
            <Button
              label="Load more paused posts"
              onPress={loading ? undefined : () => void load(true)}
            />
          )}
        </>
      }
    />
  );
}
