// app/(auth)/welcome.tsx
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { SvgXml } from "react-native-svg";
// If you're using expo-image or just Image for SVG via URI, swap accordingly.
// With @expo/vector-icons or expo-asset you can also do:
// import SCDTLogo from "../../assets/images/scdt-logo.svg";

// ─── Design Tokens ───────────────────────────────────────────────
const C = {
  bg: "#0a2e1a",
  bgCard: "rgba(255,255,255,0.06)",
  bgCardBorder: "rgba(255,255,255,0.1)",
  accent: "#4ade80",
  accentDark: "#0a2e1a",
  white: "#ffffff",
  whiteMuted: "rgba(255,255,255,0.55)",
  whiteFaint: "rgba(255,255,255,0.25)",
};

const features = [
  { icon: "💰", label: "Track savings" },
  { icon: "🏦", label: "Loan management" },
  { icon: "📈", label: "Investments" },
  { icon: "👥", label: "Member tools" },
];

export default function WelcomeScreen() {
  const router = useRouter();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={styles.container}>
      {/* Decorative circles */}
      <View style={styles.circle1} />
      <View style={styles.circle2} />

      <Animated.View
        style={[
          styles.content,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Logo */}
        <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: "center" }}>
          <View style={styles.featuresGrid}>
            <LogoImage />
          </View>
        </Animated.View>

        {/* Tagline */}
        <Text style={styles.tagline}>
          Friends, Family & Coworkers,{"\n"}
          <Text style={styles.taglineAccent}>Manage savings gone digital.</Text>
        </Text>

        {/* Features — 2×2 grid */}
        <View style={styles.featuresGrid}>
          {features.map((f, i) => (
            <View key={i} style={styles.featureCard}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => router.push("/(auth)/register")}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>Get Started →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={() => router.push("/(auth)/login")}
            activeOpacity={0.85}
          >
            <Text style={styles.btnSecondaryText}>Sign In</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          By continuing, you agree to our Terms of Service
        </Text>
      </Animated.View>
    </View>
  );
}

// ─── Logo Component ───────────────────────────────────────────────
// Renders assets/images/brand-logo.png, which scripts/sync-client-assets.js
// copies from clients/<CLIENT_ID>/assets/logo.png before every
// start/build. Metro's require() needs a static string literal, so this
// path can't be built from CLIENT_ID directly — the sync script is what
// makes the *contents* of this fixed path client-specific. Re-run
// `node scripts/sync-client-assets.js` (or just `npm start`, which now
// runs it automatically) after switching CLIENT_ID.

function LogoImage() {
  const { Image } = require("react-native");
  return (
    <Image
      source={require("../../assets/images/brand-logo.png")}
      style={{ width: 56, height: 56 }}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    overflow: "hidden",
  },

  // Decorative background circles
  circle1: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(74,222,128,0.07)",
  },
  circle2: {
    position: "absolute",
    bottom: -60,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(74,222,128,0.05)",
  },

  // Main content
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "ios" ? 64 : 48,
    paddingBottom: 40,
    alignItems: "center",
  },

  // Logo
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.white,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },

  // Headings
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: C.white,
    letterSpacing: -0.3,
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: C.whiteMuted,
    textAlign: "center",
    marginBottom: 28,
  },

  // Tagline
  tagline: {
    fontSize: 18,
    fontWeight: "500",
    color: C.white,
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 36,
  },
  taglineAccent: {
    color: C.accent,
  },

  // Features grid
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 36,
    gap: 10,
  },
  featureCard: {
    width: "48%",
    backgroundColor: C.bgCard,
    borderWidth: 0.5,
    borderColor: C.bgCardBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureIcon: {
    fontSize: 20,
  },
  featureLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
    flexShrink: 1,
  },

  // Buttons
  actions: {
    width: "100%",
    gap: 10,
    marginBottom: 20,
  },
  btnPrimary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnPrimaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.accentDark,
  },
  btnSecondary: {
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.3)",
    paddingVertical: 15,
    alignItems: "center",
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: "500",
    color: C.white,
  },

  // Footer
  footer: {
    fontSize: 10,
    color: C.whiteFaint,
    textAlign: "center",
  },
});