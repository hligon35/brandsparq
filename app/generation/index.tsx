import { IconButton } from "@/components/icon-button";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
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
  async function load() {
    try {
      setJobs((await api.getGenerationJobs()).data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load generation.");
    } finally {
      setLoaded(true);
    }
  }
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 5000);
      return () => clearInterval(timer);
    }, []),
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
        action={<IconButton label="Refresh generation" onPress={load} />}
      />
      {!!error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={load} />
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
            <Text style={styles.text}>Stage: {job.stage || "queued"}</Text>
            <Text style={styles.text}>
              Graphics: {job.graphics_completed} of {job.graphics_total} complete ·{" "}
              {job.graphics_failed} failed
            </Text>
            {!!job.error_message && <Text style={styles.error}>{job.error_message}</Text>}
            <View style={styles.row}>
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
    </PageScroll>
  );
}
