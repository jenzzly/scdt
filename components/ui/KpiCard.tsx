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
  /**
   * How this card should size itself within its parent:
   * - "grid" (default): used inside a `flexWrap: "wrap"` row of cards
   *   (dashboard, contributions, investments, wallet, reports). Takes a
   *   percentage share of the row so two cards fit per line on any
   *   phone width, and grows to fill leftover space.
   * - "fixed": used inside a horizontally-scrolling row (meetings' and
   *   members' mobile KPI strip). A percentage/flexGrow basis makes no
   *   sense inside a ScrollView's intrinsically-sized content row — with
   *   no bounded parent width to share, "47%"/flexGrow either collapses
   *   each card to a sliver or renders unpredictably across devices,
   *   which is what made these cards effectively disappear on mobile.
   *   "fixed" gives the card its own concrete width instead, so it lays
   *   out correctly as one scrollable chip among several.
   */
  layout?: "grid" | "fixed";
}

export function KpiCard({ label, value, icon, subtext, accentColor = C.primary, onPress, layout = "grid" }: KpiCardProps) {
  return (
    <TouchableOpacity
      style={[styles.kpiCard, layout === "fixed" && styles.kpiCardFixed]}
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
    // A fixed minWidth (150) forces 2-up rows to need 310px+ of usable
    // width once the 10px gap is added. On a 320-375px-wide phone with
    // 16px screen padding on each side, that's only ~288-343px available —
    // not enough for two 150px cards, so the grid silently wraps into a
    // lopsided "1 card, then 1 card alone on its own row" layout instead
    // of a clean 2-column grid. A percentage basis scales with whatever
    // width the parent actually has instead of a device-specific guess.
    flexBasis: "47%" as any,
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "space-between",
  },
  kpiCardFixed: {
    // Fixed layout: no flexBasis/flexGrow (they need a bounded parent
    // width, which a horizontally-scrolling row's content container
    // doesn't have). A concrete width instead, so the card renders at a
    // predictable, visible size as one chip in a scrollable strip.
    flexBasis: undefined,
    flexGrow: 0,
    flexShrink: 0,
    width: 152,
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