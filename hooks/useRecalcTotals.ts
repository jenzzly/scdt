// hooks/useRecalcTotals.ts
import { useEffect, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useStore } from "../stores/useStore";

export function useRecalcTotals() {
  const { recalcTotals, syncStatus } = useStore();
  
  // Recalc when sync completes
  useEffect(() => {
    if (syncStatus === "synced" && recalcTotals && typeof recalcTotals === 'function') {
      recalcTotals();
    }
  }, [syncStatus, recalcTotals]);
  
  // Recalc when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (recalcTotals && typeof recalcTotals === 'function') {
        recalcTotals();
      }
    }, [recalcTotals])
  );
}