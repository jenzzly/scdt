// hooks/useRecalcTotals.ts
import { useEffect, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useStore } from "../stores/useStore";

export function useRecalcTotals() {
  const { recalcTotals, syncStatus } = useStore();

  // Recalc when sync completes
  useEffect(() => {
    if (syncStatus === "synced" && typeof recalcTotals === "function") {
      recalcTotals();
    }
  }, [syncStatus, recalcTotals]);

  // Recalc when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (typeof recalcTotals === "function") {
        recalcTotals();
      }
    }, [recalcTotals])
  );
}