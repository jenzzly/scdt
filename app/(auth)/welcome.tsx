// app/(auth)/welcome.tsx
import React, { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Platform, Animated, useWindowDimensions, ScrollView, StatusBar,
} from "react-native";
import { useRouter } from "expo-router";

// ─── Design tokens (self-contained so welcome has no theme dependency) ────────
const C = {
  bg:            "#0a2e1a",
  bgCard:        "rgba(255,255,255,0.06)",
  bgCardBorder:  "rgba(255,255,255,0.10)",
  accent:        "#4ade80",
  accentDark:    "#052010",
  white:         "#ffffff",
  whiteMuted:    "rgba(255,255,255,0.55)",
  whiteFaint:    "rgba(255,255,255,0.20)",
  goldDot:       "#facc15",
};

const FEATURES = [
  { icon: "💰", label: "Track savings",     desc: "Contributions & balances" },
  { icon: "🏦", label: "Loan management",   desc: "Apply, approve, repay"    },
  { icon: "📈", label: "Investments",        desc: "Track returns & ROI"      },
  { icon: "👥", label: "Member tools",       desc: "Roles & permissions"      },
];

const STATS = [
  { value: "100%", label: "Transparent" },
  { value: "3-step", label: "Loan approval" },
  { value: "Real-time", label: "Sync" },
];

function LogoImage() {
  const { Image } = require("react-native");
  try {
    return (
      <Image
        source={require("../../assets/images/brand-logo.png")}
        style={{ width: 52, height: 52 }}
        resizeMode="contain"
      />
    );
  } catch {
    return <Text style={{ fontSize: 32 }}>💳</Text>;
  }
}

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  // Responsive breakpoints
  const isWide   = width >= 768;   // tablet / desktop
  const isXWide  = width >= 1100;  // large desktop — show two-col layout

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(32)).current;
  const scaleAnim = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 550, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }),
    ]).start();
  }, []);

  // ── Shared inner content (hero + features + actions) ─────────────────────
  const Hero = () => (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: "center" }}>
      <View style={st.logoRing}>
        <LogoImage />
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={[st.tagline, isWide && st.taglineLg]}>
          Friends, Family & Coworkers,
        </Text>
        <Text style={[st.tagline, isWide && st.taglineLg, st.taglineAccent, { marginTop: -8 }]}>
          Manage savings gone digital.
        </Text>
      </View>
      {/* Stats strip */}
      <View style={st.statsRow}>
        {STATS.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <View style={st.statsDot} />}
            <View style={st.stat}>
              <Text style={st.statValue}>{s.value}</Text>
              <Text style={st.statLabel}>{s.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </Animated.View>
  );

  const FeatureGrid = () => (
    <Animated.View style={[
      st.featuresGrid,
      isWide && st.featuresGridWide,
      { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
    ]}>
      {FEATURES.map((f, i) => (
        <View key={i} style={[st.featureCard, isWide && st.featureCardWide]}>
          <Text style={st.featureIcon}>{f.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.featureLabel}>{f.label}</Text>
            <Text style={st.featureDesc}>{f.desc}</Text>
          </View>
        </View>
      ))}
    </Animated.View>
  );

  const Actions = () => (
    <Animated.View style={[
      st.actions,
      isWide && st.actionsWide,
      { opacity: fadeAnim },
    ]}>
      <TouchableOpacity
        style={[st.btnPrimary, isWide && st.btnWide]}
        onPress={() => router.push("/(auth)/register")}
        activeOpacity={0.85}
      >
        <Text style={st.btnPrimaryText}>Get Started →</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[st.btnSecondary, isWide && st.btnWide]}
        onPress={() => router.push("/(auth)/login")}
        activeOpacity={0.85}
      >
        <Text style={st.btnSecondaryText}>Sign In</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  // ── Wide / desktop: two-column layout ────────────────────────────────────
  if (isXWide) {
    return (
      <View style={st.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={st.circle1} />
        <View style={st.circle2} />
        <View style={st.circle3} />

        <View style={st.twoCol}>
          {/* Left panel — branding */}
          <Animated.View style={[st.leftPanel, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Hero />
            <Text style={st.leftFooter}>
              Secure · Transparent · Community-driven
            </Text>
          </Animated.View>

          {/* Right panel — features + CTA */}
          <View style={st.rightPanel}>
            <View style={st.rightCard}>
              <Text style={st.rightCardTitle}>Everything you need</Text>
              <Text style={st.rightCardSub}>One platform for your group's finances</Text>
              <FeatureGrid />
              <Actions />
              <Text style={st.footer}>By continuing you agree to our Terms of Service</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // ── Tablet: centered single column, max-width constrained ────────────────
  if (isWide) {
    return (
      <View style={st.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={st.circle1} />
        <View style={st.circle2} />
        <ScrollView
          contentContainerStyle={st.tabletScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={st.tabletCard}>
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
              <Hero />
            </Animated.View>
            <FeatureGrid />
            <Actions />
            <Text style={st.footer}>By continuing you agree to our Terms of Service</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Mobile: full-screen scrollable ───────────────────────────────────────
  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={st.circle1} />
      <View style={st.circle2} />
      <ScrollView
        contentContainerStyle={st.mobileScroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <Hero />
        </Animated.View>
        <FeatureGrid />
        <Actions />
        <Text style={st.footer}>By continuing you agree to our Terms of Service</Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    overflow: "hidden",
  },

  // Decorative blobs
  circle1: {
    position: "absolute", top: -100, right: -100,
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: "rgba(74,222,128,0.06)",
  },
  circle2: {
    position: "absolute", bottom: -80, left: -80,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: "rgba(74,222,128,0.04)",
  },
  circle3: {
    position: "absolute", top: "40%", left: "30%",
    width: 400, height: 400, borderRadius: 200,
    backgroundColor: "rgba(74,222,128,0.02)",
  },

  // ── Mobile scroll ─────────────────────────────────────────────────────────
  mobileScroll: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 64 : 48,
    paddingBottom: 40,
    alignItems: "center",
  },

  // ── Tablet scroll ─────────────────────────────────────────────────────────
  tabletScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    minHeight: "100%",
  },
  tabletCard: {
    width: "100%" as any,
    maxWidth: 600,
    alignItems: "center",
  },

  // ── Two-column desktop ────────────────────────────────────────────────────
  twoCol: {
    flex: 1,
    flexDirection: "row",
  },
  leftPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 60,
  },
  leftFooter: {
    marginTop: 32,
    fontSize: 12,
    color: C.whiteFaint,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  rightPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.06)",
  },
  rightCard: {
    width: "100%" as any,
    maxWidth: 440,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: 36,
  },
  rightCardTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.white,
    marginBottom: 4,
  },
  rightCardSub: {
    fontSize: 13,
    color: C.whiteMuted,
    marginBottom: 24,
  },

  // ── Logo ──────────────────────────────────────────────────────────────────
  logoRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(74,222,128,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(74,222,128,0.30)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },

  // ── Tagline ───────────────────────────────────────────────────────────────
  tagline: {
    fontSize: 20,
    fontWeight: "600",
    color: C.white,
    textAlign: "center",
    lineHeight: 30,
    marginBottom: 20,
    maxWidth: 320,
  },
  taglineLg: {
    fontSize: 26,
    lineHeight: 38,
    maxWidth: 420,
  },
  taglineAccent: { color: C.accent },

  // ── Stats strip ───────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
    gap: 16,
  },
  stat: { alignItems: "center" },
  statValue: { fontSize: 14, fontWeight: "700", color: C.accent },
  statLabel: { fontSize: 10, color: C.whiteMuted, marginTop: 1 },
  statsDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.20)",
  },

  // ── Feature cards ─────────────────────────────────────────────────────────
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%" as any,
    gap: 10,
    marginBottom: 28,
  },
  featuresGridWide: {
    gap: 12,
  },
  featureCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: C.bgCard,
    borderWidth: 0.5,
    borderColor: C.bgCardBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureCardWide: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  featureIcon: { fontSize: 22 },
  featureLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.90)",
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 11,
    color: C.whiteMuted,
  },

  // ── Action buttons ────────────────────────────────────────────────────────
  actions: {
    width: "100%" as any,
    gap: 10,
    marginBottom: 16,
  },
  actionsWide: {
    flexDirection: "row",
    gap: 12,
  },
  btnPrimary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnSecondary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btnWide: { flex: 1 },
  btnPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: C.accentDark,
    letterSpacing: 0.2,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.white,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    fontSize: 10,
    color: C.whiteFaint,
    textAlign: "center",
    marginTop: 4,
  },
});
