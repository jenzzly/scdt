// components/ui/ThemeSwitch.tsx
//
// Light/dark pill switch, styled to match ViewSwitch so the two read
// as a matched pair when they appear in the same header row.
//
// Flips themeMode in the store and re-renders its own track/thumb/
// label. The rest of the app does not yet respond to themeMode — see
// scripts/add_theme_toggle.py for the scope note.
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useStore } from "../../stores/useStore";
import { C as LightPalette, D as DarkPalette, type Palette } from "../../utils/theme";
import { useTheme } from "../../hooks/useTheme";

interface ThemeSwitchProps {
  compact?: boolean;
}

export function ThemeSwitch({ compact = false }: ThemeSwitchProps) {
  const themeMode = useStore((s) => s.themeMode);
  const setThemeMode = useStore((s) => s.setThemeMode);
  const C = useTheme();

  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const toggle = () => {
    setThemeMode(isDark ? "light" : "dark");
  };

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.8}
      style={[styles.container, compact && styles.containerCompact]}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={`Switch to ${isDark ? "Light" : "Dark"} mode`}
    >
      <Text style={styles.icon}>{isDark ? "🌙" : "☀️"}</Text>

      <View
        style={[
          styles.track,
          isDark ? styles.trackDark : styles.trackLight,
        ]}
      >
        <View
          style={[
            styles.thumb,
            isDark ? styles.thumbDark : styles.thumbLight,
          ]}
        />
      </View>

      <Text style={[styles.modeLabel, isDark && styles.modeLabelDark]}>
        {isDark ? "Dark" : "Light"}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
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
  icon: {
    fontSize: 13,
  },
  track: {
    width: 34,
    height: 18,
    borderRadius: 10,
    padding: 2,
    justifyContent: "center",
  },
  trackLight: {
    backgroundColor: "#CBD5E1",
  },
  trackDark: {
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
  thumbLight: {
    alignSelf: "flex-start",
  },
  thumbDark: {
    alignSelf: "flex-end",
  },
  modeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
    minWidth: 34,
  },
  modeLabelDark: {
    color: C.primary,
  },
});

const lightStyles = makeStyles(LightPalette);
const darkStyles = makeStyles(DarkPalette);

export default ThemeSwitch;
