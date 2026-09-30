// components/ui/ModalShell.tsx
// Shared responsive wrapper for every modal/form screen.
// On mobile  : full-screen, keyboard-aware
// On tablet  : centred card, max-width 520px, shadow
// On desktop : centred card, max-width 560px, visible backdrop
import React, { useMemo } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  useWindowDimensions, StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C as LightPalette, D as DarkPalette, S, type Palette } from "../../utils/theme";
import { useTheme, useThemeMode } from "../../hooks/useTheme";
import { KeyboardAwareScrollView } from "./KeyboardAwareScrollView";

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Override the default max-width on web (default 540) */
  maxWidth?: number;
  /** Right-side header action */
  headerRight?: React.ReactNode;
  /**
   * Disable the built-in scroll. Use when the screen renders its own
   * <KeyboardAwareScrollView> (the body then fills the card with no extra
   * padding, so the screen's own `styles.body` padding is the only one).
   */
  noScroll?: boolean;
}

export function ModalShell({
  title, onClose, children, maxWidth = 540, headerRight, noScroll,
}: ModalShellProps) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const st = isDark ? darkSt : lightSt;

  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isWide = isWeb && width >= 640;
  const insets = useSafeAreaInsets();
  // Native modal presentation (expo-router `presentation: "modal"`)
  // doesn't always inherit the same status-bar handling as a normal
  // screen push, and this shell previously used a hardcoded
  // `paddingTop: 56/40` guess. On devices where that guess undershoots
  // the real notch/status-bar height, the header (with the close
  // button) renders partially behind the status bar — which can look
  // like a second, misaligned button/header bleeding through from
  // whatever's underneath. `insets.top` is the actual measured value
  // for this device, so use it as a floor under the existing padding
  // instead of a fixed number.
  const headerPaddingTop = Math.max(insets.top + 8, Platform.OS === "ios" ? 56 : 40);

  const card = (
    <View style={[st.card, isWide && { maxWidth, width: "100%" as any, borderRadius: 20 }]}>
      {/* Header */}
      <View style={[st.header, { paddingTop: headerPaddingTop }]}>
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
        <View style={st.fill}>{children}</View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={st.body}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </KeyboardAwareScrollView>
      )}
    </View>
  );

  // No KeyboardAvoidingView here on purpose: KeyboardAwareScrollView already
  // pads + scrolls for the keyboard, and stacking both double-compensates
  // (input jumps too high, or a blank gap appears above the keyboard).
  const inner = isWide ? <View style={st.backdrop}>{card}</View> : card;

  return (
    <View style={st.root}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={C.surface} />
      {inner}
    </View>
  );
}

const makeSt = (C: Palette) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    flex: 1,
    backgroundColor: C.bg,
    // Web: card appearance
    ...(Platform.OS === "web" ? {
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      maxHeight: "90vh",
    } as any : {}),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
    // Rounded top for web card
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
    flex: 1,
    textAlign: "center",
  },
  cancel: {
    fontSize: 16,
    color: C.text3,
    fontWeight: "600",
    minWidth: 40,
  },
  fill: {
    flex: 1,
  },
  body: {
    padding: S.lg,
    paddingBottom: 60,
  },
});

const lightSt = makeSt(LightPalette);
const darkSt = makeSt(DarkPalette);
