import { refreshPages } from "@/shared/refresh-pages";
import { IconButton } from "@/components/icon-button";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
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
  const [status, setStatus] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const pagingRef = useRef(false);
  async function load(more = false, refresh = false) {
    if (refresh && pagingRef.current) return;
    pagingRef.current = true;
    setPaging(true);
    const version = ++loadVersion.current;
    try {
      const [list, requested] = await Promise.all([
        api.getGenerationJobs({
          search: query,
          status,
          ...(more && nextCursor ? { cursor: nextCursor } : {}),
        }),
        jobId ? api.getGenerationJob(jobId) : Promise.resolve(null),
      ]);
      if (refresh) {
        const refreshed = await refreshPages(list, visibleCount.current, (cursor) =>
          api.getGenerationJobs({ search: query, status, cursor }),
        );
        list.data = refreshed.data;
        list.nextCursor = refreshed.nextCursor;
      }
      if (version !== loadVersion.current) return;
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
      if (version !== loadVersion.current) return;
      setError(e instanceof Error ? e.message : "Unable to load generation.");
    } finally {
      if (version === loadVersion.current) {
        setLoaded(true);
        setPaging(false);
        pagingRef.current = false;
      }
    }
  }
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(false, true), 5000);
      return () => {
        loadVersion.current++;
        clearInterval(timer);
      };
    }, [jobId, query, status]),
  );
  async function action(id: string, kind: "retry" | "cancel") {
    setWorking(id);
    try {
      await api.generationAction(id, kind);
      await load();
    } catch (e) {
      Alert.alert("Unable to update generation", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking("");
    }
  }
  const rows = [...jobs].sort((a, b) => Number(b.id === jobId) - Number(a.id === jobId));
  return (
    <PageScroll>
      <PageHeader
        eyebrow="Creative production"
        title="Generation progress"
        subtitle="Follow campaign planning, graphics and review readiness. Updates every five seconds."
        action={<IconButton label="Refresh generation" onPress={() => void load()} />}
      />
      <TextInput
        accessibilityLabel="Search generation jobs"
        placeholder="Search client or error"
        value={query}
        onChangeText={setQuery}
        style={{ minHeight: 48, padding: 12 }}
      />
      <View style={styles.row}>
        {["", "queued", "rendering", "completed", "failed", "canceled"].map((value) => (
          <Button
            key={value}
            label={value || "All jobs"}
            small
            secondary={status !== value}
            onPress={() => setStatus(value)}
          />
        ))}
      </View>
      {!!error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={() => void load()} />
        </Card>
      )}
      {!loaded ? (
        <Text style={styles.text}>Loading generation jobs…</Text>
      ) : !rows.length ? (
        <Card>
          <Text style={styles.text}>No generation jobs yet.</Text>
        </Card>
      ) : (
        rows.map((job) => (
          <Card key={job.id}>
            <View style={styles.row}>
              <StatusBadge label={job.status} />
              <Text style={styles.text}>{job.client_name}</Text>
            </View>
            <Text style={styles.text}>
              {job.creation_options
                ? JSON.parse(job.creation_options).mode === "social"
                  ? "Single social post"
                  : `${JSON.parse(job.creation_options).outputCount}-post campaign`
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
                JSON.parse(job.post_ids).map((id: string) => (
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
          </Card>
        ))
      )}
      {!!nextCursor && (
        <Button
          label={paging ? "Loading…" : "Load more jobs"}
          secondary
          onPress={paging ? undefined : () => void load(true)}
        />
      )}
    </PageScroll>
  );
}
