import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useStore } from "../../stores/useStore";
import { Colors } from "../../utils/theme";

const STATUS_CONFIG = {
  synced:  { color: Colors.success,  label: "Synced",   dot: Colors.success },
  pending: { color: Colors.warning,  label: "Pending",  dot: Colors.warning },
  syncing: { color: Colors.teal,     label: "Syncing…", dot: Colors.teal },
  failed:  { color: Colors.error,    label: "Sync failed", dot: Colors.error },
  offline: { color: Colors.text3,    label: "Offline",  dot: Colors.text3 },
};

export function SyncStatusPill() {
  const { syncStatus } = useStore();
  const pulse = useRef(new Animated.Value(1)).current;
  const cfg = STATUS_CONFIG[syncStatus as keyof typeof STATUS_CONFIG];

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

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 99, paddingVertical: 4, paddingHorizontal: 10,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontWeight: "600" },
});
