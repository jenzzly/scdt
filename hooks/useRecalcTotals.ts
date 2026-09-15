// hooks/useRecalcTotals.ts
import { useEffect, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useStore } from "../stores/useStore";

export function useRecalcTotals() {
  const recalcTotals = useStore((s) => s.recalcTotals);
  const syncStatus = useStore((s) => s.syncStatus);
  const loanCount = useStore((s) => s.loans.length);
  const walletTxCount = useStore((s) => s.walletTransactions.length);
  const contributionCount = useStore((s) => s.contributions.length);
  const investmentCount = useStore((s) => s.investments.length);

  // Recalc when sync completes.
  useEffect(() => {
    if (syncStatus === "synced" && typeof recalcTotals === "function") {
      recalcTotals();
    }
  }, [syncStatus, recalcTotals]);

  // Safety net: recalc whenever the shape of any recalc input changes,
  // so a slice that forgets to bracket its write in setSyncStatus(...)
  // still gets its totals refreshed.
  useEffect(() => {
    if (typeof recalcTotals === "function") {
      recalcTotals();
    }
  }, [
    loanCount,
    walletTxCount,
    contributionCount,
    investmentCount,
    recalcTotals,
  ]);

  // Recalc when the screen comes into focus.
  useFocusEffect(
    useCallback(() => {
      if (typeof recalcTotals === "function") {
        recalcTotals();
      }
    }, [recalcTotals]),
  );
}