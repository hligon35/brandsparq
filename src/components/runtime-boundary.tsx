import { Component, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { reportRuntimeError } from "@/diagnostics/runtime";
import { colors } from "@/theme/tokens";
export class RuntimeBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportRuntimeError(error, "render", true);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 32,
          gap: 16,
          backgroundColor: colors.bg,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ fontSize: 22, fontWeight: "800", color: colors.text }}
        >
          Let’s reopen your workspace
        </Text>
        <Text style={{ color: colors.text }}>
          Something interrupted this screen. Saved changes and recoverable drafts will load when you
          try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reopen workspace"
          onPress={() => this.setState({ failed: false })}
          style={{ minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: colors.primary }}
        >
          <Text style={{ color: colors.white, fontWeight: "800", textAlign: "center" }}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
}
