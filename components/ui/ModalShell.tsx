// components/ui/ModalShell.tsx
// Shared responsive wrapper for every modal/form screen.
// On mobile  : full-screen, keyboard-aware
// On tablet  : centred card, max-width 520px, shadow
// On desktop : centred card, max-width 560px, visible backdrop
import React from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  KeyboardAvoidingView, ScrollView, useWindowDimensions, StatusBar,
} from "react-native";
import { Colors, S, R } from "../../utils/theme";

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Override the default max-width on web (default 540) */
  maxWidth?: number;
  /** Right-side header action */
  headerRight?: React.ReactNode;
  /** Disable scroll (use when content manages its own scroll) */
  noScroll?: boolean;
}

export function ModalShell({
  title, onClose, children, maxWidth = 540, headerRight, noScroll,
}: ModalShellProps) {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isWide = isWeb && width >= 640;

  const card = (
    <View style={[st.card, isWide && { maxWidth, width: "100%" as any, borderRadius: 20 }]}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.cancel}>✕</Text>
        </TouchableOpacity>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <View style={{ minWidth: 40, alignItems: "flex-end" }}>
          {headerRight ?? <View style={{ width: 40 }} />}
        </View>
      </View>

      {/* Body */}
      {noScroll ? (
        <View style={st.body}>{children}</View>
      ) : (
        <ScrollView
          contentContainerStyle={st.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      )}
    </View>
  );

  const inner = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      {isWide ? (
        <View style={st.backdrop}>
          {card}
        </View>
      ) : (
        card
      )}
    </KeyboardAvoidingView>
  );

  return (
    <View style={st.root}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      {inner}
    </View>
  );
}

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.bg,
    // Web: card appearance
    ...(Platform.OS === "web" ? {
      boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      maxHeight: "90vh",
    } as any : {}),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 40,
    paddingBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    // Rounded top for web card
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    flex: 1,
    textAlign: "center",
  },
  cancel: {
    fontSize: 16,
    color: Colors.text3,
    fontWeight: "600",
    minWidth: 40,
  },
  body: {
    padding: S.lg,
    paddingBottom: 60,
  },
});
