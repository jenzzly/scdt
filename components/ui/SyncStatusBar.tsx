import { useEffect, useRef, useMemo } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useStore } from "../../stores/useStore";
import { C as LightPalette, D as DarkPalette, type Palette } from "../../utils/theme";
import { useTheme, useThemeMode } from "../../hooks/useTheme";

const makeStatusConfig = (C: Palette) => ({
  synced:  { color: C.success,  label: "Synced",   dot: C.success },
  pending: { color: C.warning,  label: "Pending",  dot: C.warning },
  syncing: { color: C.teal,     label: "Syncing…", dot: C.teal },
  failed:  { color: C.error,    label: "Sync failed", dot: C.error },
  offline: { color: C.text3,    label: "Offline",  dot: C.text3 },
});

export function SyncStatusPill() {
  const { syncStatus } = useStore();
  const C = useTheme();
  const mode = useThemeMode();
  const styles = mode === "dark" ? darkStyles : lightStyles;
  const config = useMemo(() => makeStatusConfig(C), [C]);

  const pulse = useRef(new Animated.Value(1)).current;
  const cfg = config[syncStatus as keyof typeof config] || config.offline;

  useEffect(() => {
    if (syncStatus === "syncing" || syncStatus === "pending") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.setValue(1);
    }
  }, [syncStatus]);

  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.dot, { backgroundColor: cfg.dot, opacity: pulse }]} />
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
    borderRadius: 99, paddingVertical: 4, paddingHorizontal: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontWeight: "600" },
});

const lightStyles = makeStyles(LightPalette);
const darkStyles = makeStyles(DarkPalette);
