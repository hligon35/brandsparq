import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { api } from "@/api/client";
import { useAuth } from "@/auth/context";
import { Button, Card, SectionTitle, StatusBadge } from "./ui";
export function WebhookJobs() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true);
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api.getWebhookEvents(next);
      if (active.current) {
        setRows((old) => (next ? [...old, ...result.data] : result.data));
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : "Unable to load webhook jobs.");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    if (user?.role === "owner") void load();
    return () => {
      active.current = false;
    };
  }, [user?.id]);
  if (user?.role !== "owner") return null;
  return (
    <Card>
      <SectionTitle
        title="Meta webhook jobs"
        subtitle="Signed events trigger account verification. They never publish content."
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <Button
        label={busy ? "Loading…" : "Refresh webhook jobs"}
        secondary
        onPress={busy ? undefined : () => load()}
      />
      {!rows.length && !busy && <Text>No webhook jobs received.</Text>}
      {rows.map((row) => (
        <Card key={row.id}>
          <Text>
            {row.event_type} · {row.created_at}
          </Text>
          <StatusBadge label={row.processing_status} />
          <Text>{row.attempt_count} attempts</Text>
          {!!row.processing_error && <Text>{row.processing_error}</Text>}
          {row.processing_status === "failed" && (
            <Button
              label="Retry webhook"
              onPress={
                busy
                  ? undefined
                  : async () => {
                      setBusy(true);
                      try {
                        await api.retryWebhookEvent(row.id);
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Retry failed.");
                      } finally {
                        setBusy(false);
                      }
                    }
              }
            />
          )}
        </Card>
      ))}
      {!!cursor && (
        <Button
          label="Load more webhook jobs"
          secondary
          onPress={busy ? undefined : () => load(cursor)}
        />
      )}
    </Card>
  );
}
