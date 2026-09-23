// app/(auth)/welcome.tsx
//
// Rewritten with SVG illustrations (community-savings hero + real
// feature icons instead of emoji) and defensive navigation:
// `safeNavigate` catches a failing router.push and falls back to
// router.replace, then to a logged warning — so a broken route never
// silently does nothing on tap.
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  useWindowDimensions,
  ScrollView,
  StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Path,
  Rect,
  Line,
  Polyline,
  Ellipse,
  G,
} from "react-native-svg";

// ─── Design tokens (self-contained, no theme dependency) ────────────
const C = {
  bg: "#0a2e1a",
  bgCard: "rgba(255,255,255,0.06)",
  bgCardBorder: "rgba(255,255,255,0.10)",
  accent: "#4ade80",
  accentDim: "rgba(74,222,128,0.55)",
  accentSoft: "rgba(74,222,128,0.18)",
  accentFaint: "rgba(74,222,128,0.06)",
  gold: "rgba(250,204,21,0.9)",
  goldSoft: "rgba(250,204,21,0.4)",
  accentDark: "#052010",
  white: "#ffffff",
  whiteMuted: "rgba(255,255,255,0.55)",
  whiteFaint: "rgba(255,255,255,0.20)",
};

// ─── Defensive navigation ───────────────────────────────────────────
//
// Wraps a router call so a missing route or an in-flight navigation
// lock can't leave the user staring at a dead button. Falls back to
// `replace` (a different primitive, sometimes succeeds where push
// fails) and logs a warning either way so the failure is visible in
// the console rather than silently swallowed.
function safeNavigate(
  router: { push: (p: any) => void; replace: (p: any) => void },
  path: string,
) {
  try {
    router.push(path);
    return;
  } catch (err) {
    console.warn(`[welcome] push(${path}) failed, trying replace:`, err);
  }

  try {
    router.replace(path);
    return;
  } catch (err) {
    console.error(`[welcome] replace(${path}) also failed:`, err);
  }
}

// ────────────────────────────────────────────────────────────────────
// SVG illustrations
// ────────────────────────────────────────────────────────────────────

/**
 * Hero illustration — a shared savings pot with coins dropping in and
 * two figures on either side. Purely decorative; sized in its own
 * coordinate space and scaled by the caller.
 */
function HeroIllustration({ width = 260 }: { width?: number }) {
  const height = Math.round((width * 200) / 260);
  return (
    <Svg width={width} height={height} viewBox="0 0 260 200">
      {/* Background rings */}
      <Circle cx="130" cy="110" r="88" fill={C.accentFaint} />
      <Circle
        cx="130"
        cy="110"
        r="70"
        stroke={C.accentSoft}
        strokeWidth="1"
        strokeDasharray="4 6"
        fill="none"
      />

      {/* Pot / bowl */}
      <Path
        d="M 75 135 Q 75 175 130 175 Q 185 175 185 135 L 185 125 L 75 125 Z"
        fill={C.accentSoft}
        stroke={C.accentDim}
        strokeWidth="2"
      />
      {/* Pot rim */}
      <Line
        x1="70"
        y1="125"
        x2="190"
        y2="125"
        stroke={C.accent}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Coins landing in the pot */}
      <Circle
        cx="105"
        cy="95"
        r="13"
        fill={C.goldSoft}
        stroke={C.gold}
        strokeWidth="1.5"
      />
      <Line
        x1="105"
        y1="87"
        x2="105"
        y2="103"
        stroke={C.gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <Line
        x1="99"
        y1="91"
        x2="111"
        y2="91"
        stroke={C.gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <Line
        x1="99"
        y1="99"
        x2="111"
        y2="99"
        stroke={C.gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      <Circle
        cx="148"
        cy="72"
        r="10"
        fill="rgba(250,204,21,0.28)"
        stroke="rgba(250,204,21,0.7)"
        strokeWidth="1.2"
      />
      <Line
        x1="148"
        y1="66"
        x2="148"
        y2="78"
        stroke="rgba(250,204,21,0.8)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      <Circle
        cx="178"
        cy="98"
        r="7"
        fill="rgba(250,204,21,0.20)"
        stroke="rgba(250,204,21,0.6)"
        strokeWidth="1"
      />

      {/* Left figure — head + shoulders */}
      <Circle cx="42" cy="130" r="13" fill={C.accent} opacity={0.85} />
      <Path
        d="M 15 178 Q 15 152 42 152 Q 69 152 69 178 Z"
        fill={C.accentDim}
      />

      {/* Right figure */}
      <Circle cx="218" cy="130" r="13" fill={C.accent} opacity={0.85} />
      <Path
        d="M 191 178 Q 191 152 218 152 Q 245 152 245 178 Z"
        fill={C.accentDim}
      />

      {/* Sparkles */}
      <Circle cx="60" cy="58" r="2" fill="rgba(250,204,21,0.6)" />
      <Circle cx="205" cy="48" r="2" fill="rgba(250,204,21,0.6)" />
      <Circle cx="80" cy="35" r="1.5" fill={C.accentDim} />
      <Circle cx="180" cy="30" r="1.5" fill={C.accentDim} />
    </Svg>
  );
}

// ── Feature icons ────────────────────────────────────────────────────

function SavingsIcon({ size = 22, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Ellipse cx="12" cy="6" rx="7.5" ry="2.6" stroke={color} strokeWidth="1.6" />
      <Path
        d="M 4.5 6 V 12 Q 4.5 14.6 12 14.6 Q 19.5 14.6 19.5 12 V 6"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <Path
        d="M 4.5 12 V 18 Q 4.5 20.6 12 20.6 Q 19.5 20.6 19.5 18 V 12"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function LoanIcon({ size = 22, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 9 L 12 3 L 21 9"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="3" y1="9" x2="21" y2="9" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="6" y1="11" x2="6" y2="18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="10" y1="11" x2="10" y2="18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="14" y1="11" x2="14" y2="18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="18" y1="11" x2="18" y2="18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="3" y1="18" x2="21" y2="18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="2" y1="21" x2="22" y2="21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

function InvestmentIcon({ size = 22, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="3,17 8,12 13,15 20,6"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="15,6 20,6 20,11"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="3" y1="21" x2="21" y2="21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

function TeamIcon({ size = 22, color = C.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="8" r="3" stroke={color} strokeWidth="1.6" />
      <Path
        d="M 3 19 Q 3 13.5 9 13.5 Q 15 13.5 15 19"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <Circle cx="17.5" cy="9" r="2.4" stroke={color} strokeWidth="1.6" />
      <Path
        d="M 14 19 Q 14 14.5 17.5 14.5 Q 21.5 14.5 21.5 19"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// Static content
// ────────────────────────────────────────────────────────────────────

const FEATURES = [
  { Icon: SavingsIcon,    label: "Track savings",   desc: "Contributions & balances" },
  { Icon: LoanIcon,       label: "Loan management", desc: "Apply, approve, repay"    },
  { Icon: InvestmentIcon, label: "Investments",      desc: "Track returns & ROI"      },
  { Icon: TeamIcon,       label: "Member tools",     desc: "Roles & permissions"      },
];

const STATS = [
  { value: "100%",      label: "Transparent"     },
  { value: "3-step",    label: "Loan approval"   },
  { value: "Real-time", label: "Sync"            },
];

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const isWide = width >= 768;
  const isXWide = width >= 1100;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(32)).current;
  const scaleAnim = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 550, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleGetStarted = () => safeNavigate(router, "/(auth)/register");
  const handleSignIn = () => safeNavigate(router, "/(auth)/login");

  // ── Shared blocks ────────────────────────────────────────────────
  const Hero = () => (
    <Animated.View
      style={{
        transform: [{ scale: scaleAnim }],
        alignItems: "center",
        width: "100%",
      }}
    >
      <HeroIllustration width={isWide ? 300 : 260} />

      <Text style={[st.tagline, isWide && st.taglineLg, { marginTop: 20 }]}>
        Friends, Family &amp; Coworkers,
      </Text>
      <Text
        style={[
          st.tagline,
          isWide && st.taglineLg,
          st.taglineAccent,
          { marginTop: -6 },
        ]}
      >
        Manage savings gone digital.
      </Text>

      <View style={st.statsRow}>
        {STATS.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={st.statsDot} /> : null}
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
    <Animated.View
      style={[
        st.featuresGrid,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {FEATURES.map(({ Icon, label, desc }, i) => (
        <View key={i} style={st.featureCard}>
          <View style={st.featureIconWrap}>
            <Icon size={20} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.featureLabel}>{label}</Text>
            <Text style={st.featureDesc}>{desc}</Text>
          </View>
        </View>
      ))}
    </Animated.View>
  );

  const Actions = () => (
    <Animated.View
      style={[st.actions, isWide && st.actionsWide, { opacity: fadeAnim }]}
    >
      <TouchableOpacity
        style={[st.btnPrimary, isWide && st.btnWide]}
        onPress={handleGetStarted}
        activeOpacity={0.85}
      >
        <Text style={st.btnPrimaryText}>Get Started →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[st.btnSecondary, isWide && st.btnWide]}
        onPress={handleSignIn}
        activeOpacity={0.85}
      >
        <Text style={st.btnSecondaryText}>Sign In</Text>
      </TouchableOpacity>
    </Animated.View>
  );

  // ── Desktop (two-column) ─────────────────────────────────────────
  if (isXWide) {
    return (
      <SafeAreaView style={st.root} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={st.circle1} />
        <View style={st.circle2} />
        <View style={st.circle3} />

        <View style={st.twoCol}>
          <Animated.View
            style={[
              st.leftPanel,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Hero />
            <Text style={st.leftFooter}>
              Secure · Transparent · Community-driven
            </Text>
          </Animated.View>

          <View style={st.rightPanel}>
            <View style={st.rightCard}>
              <Text style={st.rightCardTitle}>Everything you need</Text>
              <Text style={st.rightCardSub}>
                One platform for your group's finances
              </Text>
              <FeatureGrid />
              <Actions />
              <Text style={st.footer}>
                By continuing you agree to our Terms of Service
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Tablet ──────────────────────────────────────────────────────
  if (isWide) {
    return (
      <SafeAreaView style={st.root} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={st.circle1} />
        <View style={st.circle2} />
        <ScrollView
          contentContainerStyle={st.tabletScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={st.tabletCard}>
            <Animated.View
              style={{
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
                alignItems: "center",
                width: "100%",
              }}
            >
              <Hero />
            </Animated.View>
            <FeatureGrid />
            <Actions />
            <Text style={st.footer}>
              By continuing you agree to our Terms of Service
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Mobile ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.root} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={st.circle1} />
      <View style={st.circle2} />
      <ScrollView
        contentContainerStyle={st.mobileScroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            alignItems: "center",
            width: "100%",
          }}
        >
          <Hero />
        </Animated.View>
        <FeatureGrid />
        <Actions />
        <Text style={st.footer}>
          By continuing you agree to our Terms of Service
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: "hidden" },

  // Decorative blobs
  circle1: {
    position: "absolute",
    top: -100,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(74,222,128,0.06)",
  },
  circle2: {
    position: "absolute",
    bottom: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(74,222,128,0.04)",
  },
  circle3: {
    position: "absolute",
    top: "40%",
    left: "30%",
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: "rgba(74,222,128,0.02)",
  },

  // ── Scroll containers ──
  mobileScroll: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
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

  // ── Two-column desktop ──
  twoCol: { flex: 1, flexDirection: "row" },
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

  // ── Tagline ──
  tagline: {
    fontSize: 20,
    fontWeight: "600",
    color: C.white,
    textAlign: "center",
    lineHeight: 30,
    maxWidth: 320,
  },
  taglineLg: {
    fontSize: 26,
    lineHeight: 38,
    maxWidth: 460,
  },
  taglineAccent: { color: C.accent },

  // ── Stats strip ──
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 8,
    gap: 16,
  },
  stat: { alignItems: "center" },
  statValue: { fontSize: 14, fontWeight: "700", color: C.accent },
  statLabel: { fontSize: 10, color: C.whiteMuted, marginTop: 1 },
  statsDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.20)",
  },

  // ── Feature grid ──
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%" as any,
    gap: 10,
    marginTop: 28,
    marginBottom: 28,
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
  featureIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(74,222,128,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.90)",
    marginBottom: 2,
  },
  featureDesc: { fontSize: 11, color: C.whiteMuted },

  // ── Action buttons ──
  actions: { width: "100%" as any, gap: 10, marginBottom: 16 },
  actionsWide: { flexDirection: "row", gap: 12 },
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
  btnSecondaryText: { fontSize: 15, fontWeight: "600", color: C.white },

  // ── Footer ──
  footer: {
    fontSize: 10,
    color: C.whiteFaint,
    textAlign: "center",
    marginTop: 4,
  },
});
