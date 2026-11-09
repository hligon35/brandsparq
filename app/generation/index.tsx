import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EssentialRow, essentialStyles } from "@/components/essential";
import { refreshPages } from "@/shared/refresh-pages";
import { IconButton } from "@/components/icon-button";
import { Link, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageList, StatusBadge } from "@/components/ui";
export default function GenerationScreen() {
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const can = useCapabilities();
  const [jobs, setJobs] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [loaded, setLoaded] = useState(false);
  const loadVersion = useRef(0);
  const visibleCount = useRef(0);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query);
  const [status, setStatus] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const pagingRef = useRef(false);
  async function load(more = false, preserve = false, isCurrent = refresh.active) {
    pagingRef.current = true;
    setPaging(true);
    const version = ++loadVersion.current;
    try {
      const [list, requested] = await Promise.all([
        api.getGenerationJobs({
          search,
          status,
          ...(more && nextCursor ? { cursor: nextCursor } : {}),
        }),
        jobId ? api.getGenerationJob(jobId) : Promise.resolve(null),
      ]);
      if (preserve) {
        const refreshed = await refreshPages(list, visibleCount.current, (cursor) => {
          if (!isCurrent()) throw new Error("Refresh canceled");
          return api.getGenerationJobs({ search, status, cursor });
        });
        list.data = refreshed.data;
        list.nextCursor = refreshed.nextCursor;
      }
      if (version !== loadVersion.current || !isCurrent()) return;
      setJobs((old) => {
        visibleCount.current = more ? old.length + list.data.length : list.data.length;
        const rows = more
          ? [...old.filter((row) => !list.data.some((item) => item.id === row.id)), ...list.data]
          : list.data;
        return [
          ...new Map(
            [...(requested ? [requested.data] : []), ...rows].map((row) => [row.id, row]),
          ).values(),
        ];
      });
      setNextCursor(list.nextCursor);
      setError("");
    } catch (e) {
      if (version !== loadVersion.current || !isCurrent()) return;
      setError(e instanceof Error ? e.message : "Unable to load generation.");
    } finally {
      if (version === loadVersion.current) {
        pagingRef.current = false;
        if (isCurrent()) {
          setLoaded(true);
          setPaging(false);
        }
      }
    }
  }
  const refresh = useFocusedRefresh(
    async (context) => {
      if (
        (working && context.reason !== "manual") ||
        (context.reason === "poll" &&
          (pagingRef.current ||
            !jobs.some((job) => ["queued", "retrying", "rendering"].includes(job.status))))
      )
        return;
      await load(false, true, context.current);
    },
    [jobId, search, status],
    5000,
  );
  async function action(id: string, kind: "retry" | "cancel") {
    setWorking(id);
    try {
      await api.generationAction(id, kind);
      await refresh();
    } catch (e) {
      Alert.alert("Unable to update generation", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking("");
    }
  }
  const rows = [...jobs].sort((a, b) => Number(b.id === jobId) - Number(a.id === jobId));
  return (
    <PageList
      data={rows}
      keyExtractor={(job) => job.id}
      extraData={working}
      refreshing={paging}
      onRefresh={refresh}
      header={
        <>
          <PageHeader
            title="Generation progress"
            subtitle="Creation progress and recovery."
            action={<IconButton label="Refresh generation" onPress={() => void refresh()} />}
          />
          <TextInput
            accessibilityLabel="Search generation jobs"
            placeholder="Search client or error"
            value={query}
            onChangeText={setQuery}
            style={essentialStyles.input}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {["", "queued", "rendering", "completed", "failed", "canceled"].map((value) => (
              <Button
                key={value}
                label={value || "All jobs"}
                small
                secondary={status !== value}
                onPress={() => setStatus(value)}
              />
            ))}
          </ScrollView>
          {!!error && (
            <Card>
              <Text style={styles.error}>{error}</Text>
              <Button label="Try again" onPress={() => void refresh()} />
            </Card>
          )}
        </>
      }
      renderItem={({ item: job }) => (
        <Card>
          <EssentialRow key={job.id} title={job.client_name || "Client"}>
            <View style={styles.row}>
              <StatusBadge label={job.status} />
              <Text style={styles.text}>{job.client_name}</Text>
            </View>
            <Text style={styles.text}>
              {job.creation_options
                ? parseOptions(job.creation_options).mode === "social"
                  ? "Single social post"
                  : `${parseOptions(job.creation_options).outputCount}-post campaign`
                : "Campaign"}
            </Text>
            <Text style={styles.text}>Stage: {job.stage || "queued"}</Text>
            <Text style={styles.text}>
              Graphics: {job.graphics_completed} of {job.graphics_total} complete ·{" "}
              {job.graphics_failed} failed
            </Text>
            {!!job.error_message && <Text style={styles.error}>{job.error_message}</Text>}
            <View style={styles.row}>
              {!job.campaign_id &&
                job.post_ids &&
                parsePostIds(job.post_ids).map((id: string) => (
                  <Link key={id} href={`/posts/${id}`} asChild>
                    <Button label="Open social post" secondary small />
                  </Link>
                ))}
              {job.campaign_id && (
                <Link href={`/campaigns/${job.campaign_id}`} asChild>
                  <Button label="Open campaign" secondary small />
                </Link>
              )}
              {can("generate", job.client_id) && job.client_status === "active" && (
                <>
                  {["failed", "canceled"].includes(job.status) && (
                    <Button
                      small
                      label="Retry generation"
                      onPress={working ? undefined : () => action(job.id, "retry")}
                    />
                  )}
                  {["queued", "retrying", "rendering"].includes(job.status) && (
                    <Button
                      small
                      secondary
                      label="Cancel generation"
                      onPress={working ? undefined : () => action(job.id, "cancel")}
                    />
                  )}
                </>
              )}
            </View>
          </EssentialRow>
        </Card>
      )}
      empty={
        <Card>
          <Text style={styles.text}>
            {loaded ? "No generation jobs yet." : "Loading generation jobs…"}
          </Text>
        </Card>
      }
      footer={
        <>
          {!!nextCursor && (
            <Button
              label={paging ? "Loading…" : "Load more jobs"}
              secondary
              onPress={paging ? undefined : () => void load(true)}
            />
          )}
        </>
      }
    />
  );
}
function parseOptions(value: string): { mode?: string; outputCount?: number } {
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}
function parsePostIds(value: string): string[] {
  try {
    const rows = JSON.parse(value);
    return Array.isArray(rows) ? rows.filter((id) => typeof id === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}
