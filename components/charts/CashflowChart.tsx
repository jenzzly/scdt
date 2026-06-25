import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { BarChart } from "react-native-chart-kit";
import { Colors, S, R, fmtCurrency } from "../../utils/theme";

const SCREEN_W = Dimensions.get("window").width;

interface Props {
  months: string[];
  income: number[];
  expenses: number[];
  width?: number;
  height?: number;
}

export function CashflowChart({ months, income, expenses, width, height = 180 }: Props) {
  const chartW = width ?? SCREEN_W - S.lg * 2 - 32;

  if (!months.length) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  return (
    <View>
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
      <BarChart
        data={{
          labels: months,
          datasets: [
            { data: income, color: (o = 1) => `rgba(45,161,152,${o})` },
            { data: expenses, color: (o = 1) => `rgba(245,183,49,${o})` },
          ],
        }}
        width={chartW}
        height={height}
        yAxisLabel=""
        yAxisSuffix=""
        chartConfig={{
          backgroundColor: Colors.surface,
          backgroundGradientFrom: Colors.surface,
          backgroundGradientTo: Colors.surface,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(45,161,152,${opacity})`,
          labelColor: () => Colors.text3,
          style: { borderRadius: R.md },
          propsForBackgroundLines: { stroke: Colors.border, strokeDasharray: "4" },
          barPercentage: 0.6,
          formatYLabel: (v) => {
            const n = parseFloat(v);
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return String(n);
          },
        }}
        style={{ borderRadius: R.md, marginTop: 8 }}
        withInnerLines
        showValuesOnTopOfBars={false}
        fromZero
      />
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 14, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: Colors.text3 },
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: Colors.text3, fontSize: 13 },
});
