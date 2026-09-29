// hooks/useTheme.ts
//
// Returns the palette the app should be rendering with, based on the
// persisted themeMode in the store.
//
//   const C = useTheme();          // Palette (C or D)
//   const T = useT();              // themed text styles
//   const mode = useThemeMode();   // "light" | "dark"
//
// Screens that still import the static C or T from utils/theme.ts
// continue rendering the light palette until they're migrated to
// consume these hooks and wrap their StyleSheet in a
// makeStyles(C: Palette) function.
//
// makeT is imported lazily inside useT rather than at the top of this
// file: utils/theme.ts pulls in ../lib/brand, and importing it at
// module load creates a load-order hazard with the store that
// consumes this hook.
import { useMemo } from "react";
import { useStore } from "../stores/useStore";
import { C, D, type Palette } from "../utils/theme";

export function useTheme(): Palette {
  const mode = useStore((s) => s.themeMode);
  return mode === "dark" ? D : C;
}

export function useThemeMode(): "light" | "dark" {
  return useStore((s) => s.themeMode);
}

export function useT() {
  const palette = useTheme();
  const { makeT } = require("../utils/theme") as typeof import("../utils/theme");
  return useMemo(() => makeT(palette), [palette]);
}
