// components/ErrorBoundary.tsx
//
// Top-level error boundary. Catches render-time errors from anywhere
// inside its subtree and replaces the failed subtree with a "Try
// Again" screen that shows the error message and component stack.
//
// Why this exists: without a boundary, a single missing import (or one
// throwing component) unmounts the entire app. In dev you get a red
// box; in production on web, a white screen. With the boundary, the
// shell (status bar, SafeAreaProvider, AutoLogoutGate) stays mounted
// and the user sees a recoverable error card with an actual message —
// which is what turns "the app is broken, no idea why" into a two-second
// diagnosis.
//
// Class component on purpose: React's error-boundary API
// (getDerivedStateFromError / componentDidCatch) has no hook
// equivalent.
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console so dev tools show the full trace. Keep
    // this even in production — the message is far more useful than a
    // silent blank screen, and console output is only visible to
    // whoever opens dev tools.
    console.error("[ErrorBoundary] caught:", error);
    if (info?.componentStack) {
      console.error("[ErrorBoundary] component stack:", info.componentStack);
    }
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (this.state.error) {
      const message =
        this.state.error.message || String(this.state.error);
      const stack = this.state.info?.componentStack ?? "";

      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              The app hit an error rendering this screen. You can try
              again, or reload the page if it keeps happening.
            </Text>

            <View style={styles.box}>
              <Text style={styles.boxLabel}>Error</Text>
              <Text style={styles.boxText} selectable>
                {message}
              </Text>
            </View>

            {!!stack && (
              <View style={styles.box}>
                <Text style={styles.boxLabel}>Component stack</Text>
                <Text style={styles.boxText} selectable>
                  {stack.trim()}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.button}
              onPress={this.handleReset}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>

            {Platform.OS === "web" && (
              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={() => {
                  if (typeof window !== "undefined") window.location.reload();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Reload the app"
              >
                <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
                  Reload App
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

// Hardcoded neutral palette on purpose. The theme lives in the store,
// which may itself be the thing that threw — pulling from it here would
// risk a second crash inside the boundary. These colors are readable on
// both light and dark system themes.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" },
  scroll: {
    padding: 24,
    paddingTop: 80,
    paddingBottom: 60,
    gap: 14,
    maxWidth: 720,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
    marginBottom: 6,
  },
  box: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    padding: 12,
  },
  boxLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  boxText: {
    fontSize: 12,
    color: "#B91C1C",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 17,
  },
  button: {
    marginTop: 8,
    backgroundColor: "#1A56DB",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  buttonSecondaryText: { color: "#1A56DB" },
});

export default ErrorBoundary;
