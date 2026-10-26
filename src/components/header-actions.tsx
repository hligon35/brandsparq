import { useGuardedNavigation } from "@/hooks/useUnsavedChanges";
import { type ComponentRef, useRef, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "@/auth/context";
import { Alert } from "@/components/feedback";
import { IconButton } from "./icon-button";
import { colors } from "@/theme/tokens";
export function HeaderActions() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const navigate = useGuardedNavigation();
  const pathname = usePathname();
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const { width, height } = useWindowDimensions();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => setPosition(null), [pathname, width, height]);
  function open() {
    anchor.current?.measureInWindow((x, y, w, h) =>
      setPosition({
        top: Math.min(y + h + 4, height - 180),
        left: Math.max(8, Math.min(x + w - 200, width - 208)),
      }),
    );
  }
  return (
    <View style={styles.actions}>
      <View ref={anchor} collapsable={false}>
        {user?.avatarUrl ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile menu"
            onPress={open}
            style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
          >
            <Image
              source={{ uri: user.avatarUrl }}
              style={{ width: 32, height: 32, borderRadius: 16 }}
            />
          </Pressable>
        ) : (
          <IconButton label="Open profile menu" icon="person-circle-outline" onPress={open} />
        )}
      </View>
      <IconButton
        label="Notifications"
        icon="notifications-outline"
        onPress={() => void navigate(() => router.push("/notifications"))}
      />
      <Modal
        visible={!!position}
        transparent
        animationType="fade"
        onRequestClose={() => setPosition(null)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close profile menu"
            onPress={() => setPosition(null)}
            style={StyleSheet.absoluteFill}
          />
          {position && (
            <View style={[styles.menu, position]}>
              {[
                { label: "Profile", path: "/profile" },
                { label: "Settings", path: "/settings" },
                { label: "Sign out", path: null },
              ].map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  onPress={() => {
                    setPosition(null);
                    if (item.path === "/settings") {
                      void navigate(() => router.push("/settings"));
                    } else if (item.path === "/profile") {
                      void navigate(() => router.push("/profile"));
                    } else
                      void navigate(() => {
                        void signOut().catch((error) =>
                          Alert.alert(
                            "Unable to sign out",
                            error instanceof Error ? error.message : "Try again.",
                          ),
                        );
                      });
                  }}
                  style={styles.item}
                >
                  <Text style={styles.label}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  overlay: { flex: 1 },
  menu: {
    position: "absolute",
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    shadowColor: colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  item: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
  label: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
