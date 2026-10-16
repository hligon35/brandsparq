import { Alert } from "@/components/feedback";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle, StatusBadge } from "@/components/ui";
import { Field, Choices } from "@/components/forms";
import { colors, radius, spacing } from "@/theme/tokens";

const roles = ["admin", "reviewer", "publisher", "viewer"];

export default function AccessScreen() {
  const [data, setData] = useState<{ users: any[]; clients: any[]; access: any[] }>({
    users: [],
    clients: [],
    access: [],
  });
  const [invitations, setInvitations] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteClients, setInviteClients] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<string>();

  async function load() {
    try {
      const result = await api.getAccessManagement();
      setData(result.data);
      setInvitations((await api.getInvitations()).data);
      if (!selected && result.data.users.length) setSelected(result.data.users[0].id);
    } catch (e) {
      Alert.alert("Unable to load access", e instanceof Error ? e.message : "Try again.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const user = useMemo(() => data.users.find((row) => row.id === selected), [data.users, selected]);
  const assigned = new Set(
    data.access.filter((row) => row.user_id === selected).map((row) => row.client_id),
  );

  async function role(next: string) {
    if (!user) return;
    try {
      await api.updateUserRole(user.id, next);
      await load();
    } catch (e) {
      Alert.alert("Role update failed", e instanceof Error ? e.message : "Try again.");
    }
  }
  async function toggle(clientId: string) {
    if (!user || user.role === "owner") return;
    try {
      await api.updateUserClientAccess(user.id, clientId, !assigned.has(clientId), user.role);
      await load();
    } catch (e) {
      Alert.alert("Access update failed", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function act(action: () => Promise<unknown>) {
    setWorking(true);
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert("Access update failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Owner controls"
        title="Access Management"
        subtitle="Assign workspace roles and exactly which clients each non-owner can access."
      />

      <Card>
        <SectionTitle
          title="Invite teammate"
          subtitle="Invitations last seven days and must be accepted with the invited Google account."
        />
        <Field label="Teammate email" value={email} onChange={setEmail} />
        <Text style={styles.muted}>Workspace role</Text>
        <Choices values={roles} value={inviteRole} onChange={setInviteRole} disabled={working} />
        <Text style={styles.muted}>Initial client access</Text>
        {data.clients.map((client) => (
          <View key={client.id} style={{ gap: 8 }}>
            <Button
              label={`${inviteClients[client.id] ? "Remove" : "Add"} ${client.name}`}
              small
              secondary
              onPress={
                working
                  ? undefined
                  : () =>
                      setInviteClients((current) => {
                        const next = { ...current };
                        if (next[client.id]) delete next[client.id];
                        else next[client.id] = inviteRole;
                        return next;
                      })
              }
            />
            {inviteClients[client.id] && (
              <Choices
                values={roles}
                value={inviteClients[client.id]}
                disabled={working}
                onChange={(role) => setInviteClients((c) => ({ ...c, [client.id]: role }))}
              />
            )}
          </View>
        ))}
        <Button
          label="Send invitation"
          onPress={
            working || !email.trim()
              ? undefined
              : () =>
                  act(async () => {
                    const result = await api.invite({
                      email,
                      role: inviteRole,
                      clientRoles: inviteClients,
                    });
                    setEmail("");
                    setInviteClients({});
                    Alert.alert(
                      "Invitation created",
                      result.deliveryStatus === "sent"
                        ? "The invitation email was sent."
                        : result.error || "Email failed. Use Resend to try again.",
                    );
                  })
          }
        />
      </Card>
      <Card>
        <SectionTitle title="Invitations" />
        {!invitations.length && <Text style={styles.muted}>No invitations yet.</Text>}
        {invitations.map((invite) => (
          <View key={invite.id} style={{ gap: 8 }}>
            <Text style={styles.muted}>
              {invite.email} · {invite.status} · email {invite.delivery_status}
            </Text>
            {!!invite.delivery_error && <Text style={styles.muted}>{invite.delivery_error}</Text>}
            {invite.status !== "accepted" && (
              <View style={styles.roles}>
                <Button
                  label="Resend invitation"
                  small
                  secondary
                  onPress={
                    working ? undefined : () => act(() => api.invitationAction(invite.id, "resend"))
                  }
                />
                {invite.status === "pending" && (
                  <Button
                    label="Revoke invitation"
                    small
                    secondary
                    onPress={
                      working
                        ? undefined
                        : () => act(() => api.invitationAction(invite.id, "revoke"))
                    }
                  />
                )}
              </View>
            )}
          </View>
        ))}
      </Card>
      <Card>
        <SectionTitle
          title="People"
          subtitle="Google-authenticated users authorized for this BrandSparQ workspace."
        />
        <View style={styles.people}>
          {data.users.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => setSelected(row.id)}
              style={[styles.person, selected === row.id && styles.personActive]}
            >
              <Text style={[styles.personName, selected === row.id && styles.personNameActive]}>
                {row.name || row.email}
              </Text>
              <Text style={[styles.personMeta, selected === row.id && styles.personMetaActive]}>
                {row.role} · {row.email}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {user && (
        <Card>
          <SectionTitle title={user.name || user.email} subtitle="Workspace role" />
          <Text style={styles.muted}>Account: {user.status}</Text>
          {user.status !== "invited" && (
            <View style={styles.roles}>
              <Button
                label={user.status === "active" ? "Suspend account" : "Reactivate account"}
                small
                secondary
                onPress={
                  working
                    ? undefined
                    : () =>
                        act(() =>
                          api.memberAction(
                            user.id,
                            "status",
                            user.status === "active" ? "suspended" : "active",
                          ),
                        )
                }
              />
              <Button
                label="Revoke sessions"
                small
                secondary
                onPress={
                  working
                    ? undefined
                    : () => act(() => api.memberAction(user.id, "revoke-sessions"))
                }
              />
              {user.status !== "removed" && (
                <Button
                  label="Remove access"
                  small
                  secondary
                  onPress={
                    working
                      ? undefined
                      : () => act(() => api.memberAction(user.id, "status", "removed"))
                  }
                />
              )}
            </View>
          )}

          {user.role === "owner" ? (
            <View style={styles.ownerNote}>
              <StatusBadge label="owner" />
              <Text style={styles.muted}>
                Owners have workspace-wide access to every client and system operation.
              </Text>
            </View>
          ) : (
            <View style={styles.roles}>
              {roles.map((value) => (
                <Pressable
                  key={value}
                  onPress={() => role(value)}
                  style={[styles.role, user.role === value && styles.roleActive]}
                >
                  <Text style={[styles.roleText, user.role === value && styles.roleTextActive]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => role("owner")} style={styles.promote}>
                <Text style={styles.promoteText}>Promote to owner</Text>
              </Pressable>
            </View>
          )}
        </Card>
      )}

      {user && (
        <Card>
          <SectionTitle
            title="Client access"
            subtitle={
              user.role === "owner"
                ? "Owners automatically see every client."
                : "Tap a client to grant or remove access."
            }
          />
          <View style={styles.clients}>
            {data.clients.map((client) => {
              const enabled = user.role === "owner" || assigned.has(client.id);
              return (
                <Pressable
                  key={client.id}
                  disabled={user.role === "owner"}
                  onPress={() => toggle(client.id)}
                  style={[styles.client, enabled && styles.clientActive]}
                >
                  <View style={[styles.check, enabled && styles.checkActive]}>
                    <Text style={styles.checkText}>{enabled ? "✓" : ""}</Text>
                  </View>
                  <Text style={styles.clientName}>{client.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {user.role !== "owner" &&
            data.clients
              .filter((client) => assigned.has(client.id))
              .map((client) => (
                <View key={client.id} style={{ gap: 8 }}>
                  <Text style={styles.clientName}>{client.name} role</Text>
                  <Choices
                    values={roles}
                    value={
                      data.access.find((a) => a.user_id === user.id && a.client_id === client.id)
                        ?.access_role || user.role
                    }
                    disabled={working}
                    onChange={(role) =>
                      void act(() => api.updateUserClientAccess(user.id, client.id, true, role))
                    }
                  />
                </View>
              ))}
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  people: { gap: 8 },
  person: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface2,
  },
  personActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  personName: { color: colors.text, fontWeight: "900" },
  personNameActive: { color: colors.white },
  personMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  personMetaActive: { color: "#D9ECFF" },
  ownerNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  muted: { color: colors.muted, lineHeight: 20, flex: 1 },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  role: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { color: colors.textSoft, fontWeight: "900", textTransform: "capitalize" },
  roleTextActive: { color: colors.white },
  promote: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.orange,
  },
  promoteText: { color: colors.orange, fontWeight: "900" },
  clients: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  client: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minWidth: 190,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clientActive: { borderColor: colors.primary, backgroundColor: "#F1F7FF" },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { color: colors.white, fontWeight: "900" },
  clientName: { color: colors.text, fontWeight: "800" },
});
