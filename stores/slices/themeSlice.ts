// stores/slices/themeSlice.ts
//
// Persisted light/dark theme mode. The switch itself lives in
// components/ui/ThemeSwitch.tsx; this slice owns the state and the
// setter, and useStore.ts persists the field via partialize so the
// preference survives a reload.
//
// The mode does not currently recolor the app — see the scope note at
// the top of scripts/add_theme_toggle.py. This slice is the seed for
// that migration.
import type { SetFn, GetFn, StoreState } from "../storeTypes";

export const createThemeSlice = (
  set: SetFn,
  get: GetFn,
): Pick<StoreState, "setThemeMode"> => ({
  setThemeMode: (mode) => set({ themeMode: mode }),
});
