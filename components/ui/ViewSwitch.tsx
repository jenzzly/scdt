// components/ui/ViewSwitch.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useStore, useHasViewToggle, useDataViewMode } from "../../stores/useStore";
import { C } from "../../utils/theme";

interface ViewSwitchProps {
  compact?: boolean;
}

export function ViewSwitch({ compact = false }: ViewSwitchProps) {
  const hasToggle = useHasViewToggle();
  const dataViewMode = useDataViewMode();
  const isGroup = isGroupViewActive(dataViewMode);
  const setDataViewMode = useStore((s) => s.setDataViewMode);

  if (!hasToggle) return null;

  const toggle = () => {
    setDataViewMode(isGroup ? "personal" : "group");
  };

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.8}
      style={[styles.container, compact && styles.containerCompact]}
      accessibilityRole="switch"
      accessibilityState={{ checked: isGroup }}
      accessibilityLabel={`Switch to ${isGroup ? "Personal" : "Group"} view`}
    >
      <Text style={styles.prefixLabel}>View</Text>
      <View style={[styles.track, isGroup ? styles.trackGroup : styles.trackPersonal]}>
        <View style={[styles.thumb, isGroup ? styles.thumbGroup : styles.thumbPersonal]} />
      </View>
      <Text style={[styles.modeLabel, isGroup && styles.modeLabelGroup]}>
        {isGroup ? "Group" : "Personal"}
      </Text>
    </TouchableOpacity>
  );
}

function isGroupViewActive(mode: string): boolean {
  return mode === "group" || mode === "admin";
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.elevated,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  containerCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
  },
  prefixLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text3,
    letterSpacing: 0.2,
  },
  track: {
    width: 34,
    height: 18,
    borderRadius: 10,
    padding: 2,
    justifyContent: "center",
  },
  trackPersonal: {
    backgroundColor: "#CBD5E1",
  },
  trackGroup: {
    backgroundColor: C.primary,
  },
  thumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  thumbPersonal: {
    alignSelf: "flex-start",
  },
  thumbGroup: {
    alignSelf: "flex-end",
  },
  modeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
    minWidth: 46,
  },
  modeLabelGroup: {
    color: C.primary,
  },
});

export default ViewSwitch;
