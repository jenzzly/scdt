// components/charts/CashflowChart.tsx
//
// Hand-built with View/Text only. react-native-chart-kit was previously used
// here but renders raw SVG <text>/<tspan> nodes that crash React Native Web
// with "Unexpected text node: . A text node cannot be a child of a <View>."
// It also computed width once from Dimensions.get("window") at import time,
// which never updates on rotation or when the window is resized. This
// version is fully responsive — it fills whatever width its parent gives it.
import React, { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import { Colors } from "../../utils/theme";

interface Props {
  months: string[];
  income: number[];
  expenses: number[];
  height?: number;
}

export function CashflowChart({ months, income, expenses, height = 150 }: Props) {
  const [, setContainerWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width);

  if (!months.length) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  const max = Math.max(1, ...income, ...expenses);
  const barAreaHeight = height - 24;

  return (
    <View onLayout={onLayout}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.teal }]} />
          <Text style={styles.legendLabel}>Income</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.gold }]} />
          <Text style={styles.legendLabel}>Expenses</Text>
        </View>
      </View>

      <View style={[styles.barsRow, { height }]}>
        {months.map((m, i) => {
          const incH = Math.max(2, (income[i] / max) * barAreaHeight);
          const expH = Math.max(2, (expenses[i] / max) * barAreaHeight);
          return (
            <View key={i} style={styles.barGroup}>
              <View style={styles.barPair}>
                <View style={[styles.bar, { height: incH, backgroundColor: Colors.teal }]} />
                <View style={[styles.bar, { height: expH, backgroundColor: Colors.gold, marginLeft: 3 }]} />
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>{m}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: Colors.text3 },
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: Colors.text3, fontSize: 13 },
  barsRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  barGroup: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barPair: { flexDirection: "row", alignItems: "flex-end" },
  bar: { width: 12, borderRadius: 3 },
  barLabel: { fontSize: 9, color: Colors.text3, marginTop: 6 },
});
