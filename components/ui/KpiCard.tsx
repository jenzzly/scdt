// components/ui/KpiCard.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { C } from "../../utils/theme";

interface KpiCardProps {
  label: string;
  value: string;
  icon: string;
  subtext?: string;
  accentColor?: string;
  onPress?: () => void;
}

export function KpiCard({ label, value, icon, subtext, accentColor = C.primary, onPress }: KpiCardProps) {
  return (
    <TouchableOpacity
      style={styles.kpiCard}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.75 : 1}
    >
      <View style={styles.kpiHeader}>
        <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
        <View style={[styles.kpiIconWrap, { backgroundColor: C.elevated }]}>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
        </View>
      </View>
      <Text style={[styles.kpiValue, { color: accentColor }]} numberOfLines={1}>{value}</Text>
      {subtext ? <Text style={styles.kpiSubtext} numberOfLines={1}>{subtext}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  kpiCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "space-between",
  },
  kpiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
    marginRight: 6,
  },
  kpiIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  kpiSubtext: {
    fontSize: 11,
    color: C.text3,
    fontWeight: "500",
    marginTop: 3,
  },
});