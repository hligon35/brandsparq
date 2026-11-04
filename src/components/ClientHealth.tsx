import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { api } from "@/api/client";
import { ClientPicker } from "./client-picker";
import { EssentialRow, EssentialSection, essentialStyles as styles } from "./essential";
import { colors } from "@/theme/tokens";
import { Button, StatusBadge } from "./ui";
import type { Client } from "@/types/domain";

export function ClientHealth() {
  const { clientId: requested } = useLocalSearchParams<{ clientId?: string }>();
  const [clientId, setClientId] = useState(requested || "all");
  const [clients, setClients] = useState<Client[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const busy = useRef(false);
  const active = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    setClientId(requested || "all");
  }, [requested]);

  const load = useCallback(
    async (force = false) => {
      if (busy.current && !force) return;
      busy.current = true;
      const current = ++version.current;
      try {
        const scope = clientId === "all" ? undefined : clientId;
        const [clientRows, accountRows, jobRows, runRows] = await Promise.all([
          api.getClients(),
          api.getSocialAccounts(scope),
          api.getAnalyticsJobs(),
          api.getAnalyticsHealth(scope),
        ]);
        if (!active.current || current !== version.current) return;
        setClients(clientRows);
        setAccounts(accountRows.data);
        setJobs(jobRows.data.filter((job) => !scope || job.client_id === scope));
        setRuns(runRows.data);
        setError("");
      } catch (e) {
        if (active.current && current === version.current)
          setError(e instanceof Error ? e.message : "Unable to load health information.");
      } finally {
        if (current === version.current) {
          busy.current = false;
          if (active.current) setLoaded(true);
        }
      }
    },
    [clientId],
  );

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setLoaded(false);
      setError("");
      setAccounts([]);
      setJobs([]);
      setRuns([]);
      void load(true);
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void load();
      }, 15000);
      return () => {
        active.current = false;
        version.current++;
        busy.current = false;
        clearInterval(timer);
      };
    }, [load]),
  );

  const pending = jobs.filter((job) => ["queued", "running"].includes(job.status));
  const issues = jobs.filter(
    (job) => ["failed", "unsupported", "partial"].includes(job.status) || Number(job.failed) > 0,
  );
  const rows = showHistory
    ? jobs
    : jobs.filter((job) => pending.includes(job) || issues.includes(job));
  return (
    <>
      <ClientPicker
        clients={[{ id: "all", name: "All clients", color: colors.primary }, ...clients]}
        value={clientId}
        onChange={(id) => {
          setClientId(id);
          setVisibleCount(10);
        }}
      />
      {!!error && (
        <View>
          <Text accessibilityRole="alert">{error}</Text>
          <Button label="Retry health" secondary onPress={() => void load()} />
        </View>
      )}
      {!loaded && <Text accessibilityLiveRegion="polite">Loading health information…</Text>}
      <EssentialSection
        title="Connections"
        summary={`${accounts.length} accounts in this workspace`}
      >
        {accounts.map((account) => (
          <EssentialRow
            key={account.id}
            title={account.account_name || account.platform}
            detail={account.platform}
            trailing={
              <StatusBadge
                label={
                  account.token_expires_at && Number(account.token_expires_at) <= Date.now()
                    ? "reauth required"
                    : account.status !== "connected"
                      ? account.status || "disconnected"
                      : account.health_status || "connected"
                }
              />
            }
          >
            {!!account.last_error && <Text style={styles.meta}>{account.last_error}</Text>}
          </EssentialRow>
        ))}
        {loaded && !accounts.length && (
          <Text style={styles.meta}>No connected accounts for this selection.</Text>
        )}
      </EssentialSection>
      <EssentialSection
        title="Analytics sync"
        summary={`${pending.length} active · ${issues.length} need attention`}
      >
        <Button
          label={showHistory ? "Hide completed syncs" : "Show sync history"}
          small
          secondary
          onPress={() => {
            setShowHistory((value) => !value);
            setVisibleCount(10);
          }}
        />
        {rows.slice(0, visibleCount).map((job) => (
          <EssentialRow
            key={job.id}
            title={job.account_name || "Social account"}
            detail={`${job.range_days} days · ${job.status} · ${job.processed} processed · ${job.failed} failed`}
            trailing={<StatusBadge label={job.status} />}
          >
            {!!job.error_message && <Text style={styles.meta}>{job.error_message}</Text>}
          </EssentialRow>
        ))}
        {loaded && !rows.length && (
          <Text style={styles.meta}>
            {showHistory ? "No sync jobs yet." : "No active syncs or sync issues."}
          </Text>
        )}
        {rows.length > visibleCount && (
          <Button
            label="Show more syncs"
            secondary
            small
            onPress={() => setVisibleCount((count) => count + 10)}
          />
        )}
      </EssentialSection>
      <EssentialSection
        title="Provider sync details"
        summary="Recent refreshes and provider errors"
        defaultOpen={false}
      >
        {runs.map((run) => (
          <EssentialRow
            key={run.id}
            title={run.account_name || run.platform || "Social account"}
            detail={`${run.client_name || "Client"} · ${new Date(run.started_at).toLocaleString()}`}
            trailing={<StatusBadge label={run.status} />}
          >
            {!!run.error_message && <Text style={styles.meta}>{run.error_message}</Text>}
          </EssentialRow>
        ))}
        {loaded && !runs.length && <Text style={styles.meta}>No provider sync runs yet.</Text>}
      </EssentialSection>
    </>
  );
}
