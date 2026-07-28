// app/(auth)/login.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
  TextInput as RNTextInput, ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../hooks/useAuth";
import { useStore } from "../../stores/useStore";
import { Input, Button, useToast } from "../../components/ui";
import { Colors, S, R, fmtCurrency } from "../../utils/theme";
import { BRAND } from "../../lib/brand";
import { FIXED_GROUP_ID } from "../../stores/fixedGroup";
import * as FS from "../../lib/firestore";

function LogoImage() {
  const { Image } = require("react-native");
  try {
    return (
      <Image
        source={require("../../assets/images/brand-logo.png")}
        style={{ width: 44, height: 44 }}
        resizeMode="contain"
      />
    );
  } catch {
    return <Text style={{ fontSize: 28, color: "#fff" }}>S</Text>;
  }
}

export default function LoginScreen() {
  const router  = useRouter();
  const { width } = useWindowDimensions();
  const { signIn, resetPassword } = useAuth();
  const { show, Toast }           = useToast();
  const { setActiveGroup, recalcTotals } = useStore();

  const isWide  = width >= 768;
  const isXWide = width >= 1100;

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent,    setResetSent]    = useState(false);
  const [showPw,       setShowPw]       = useState(false);

  const passwordRef = useRef<RNTextInput>(null);
  const emailRef    = useRef<RNTextInput>(null);

  useEffect(() => {
    if (Platform.OS === "web" && emailRef.current) {
      setTimeout(() => emailRef.current?.focus(), 120);
    }
  }, []);

  const handleLogin = async () => {
    if (!email.trim()) { show("Email address is required", "error"); emailRef.current?.focus(); return; }
    if (!password)     { show("Password is required",      "error"); passwordRef.current?.focus(); return; }
    setLoading(true);
    try {
      const user = await signIn(email.trim(), password);
      const member = await FS.ensureMemberExists(
        FIXED_GROUP_ID, user.uid, user.displayName || email.trim(), email.trim(),
      );
      if (member && member.totalContributions > 0) {
        show(`Welcome back! Balance: ${fmtCurrency(member.totalContributions)}`, "success");
      }
      recalcTotals();
      setActiveGroup(FIXED_GROUP_ID);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      const code = e?.code ?? "";
      const msg =
        code === "auth/invalid-credential" ? "Invalid email or password" :
        code === "auth/user-not-found"     ? "No account found with this email" :
        code === "auth/too-many-requests"  ? "Too many failed attempts. Try again later" :
        "Login failed. Please try again.";
      show(msg, "error");
      passwordRef.current?.focus();
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!email.trim()) { show("Enter your email address first", "error"); emailRef.current?.focus(); return; }
    setResetLoading(true); setResetSent(false);
    try {
      await resetPassword(email.trim());
      setResetSent(true);
      show("Password reset email sent! Check your inbox.", "success");
    } catch (e: any) {
      const code = e?.code ?? "";
      show(
        code === "auth/user-not-found" ? "No account found with this email" :
        code === "auth/invalid-email"  ? "Enter a valid email address" :
        "Failed to send reset email. Try again.",
        "error",
      );
    } finally { setResetLoading(false); }
  };

  // ── Shared form ───────────────────────────────────────────────────────────
  // IMPORTANT: this is a JSX *value*, not a component function. Defining it as
  // `const Form = () => (...)` creates a new component type on every render
  // (the parent re-renders on every keystroke), so React remounts the <Input>
  // subtree and kicks focus out of the field after each character typed.
  const formJsx = (
    <View style={f.form}>
      <Input
        ref={emailRef as any}
        label="Email Address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        leftIcon="📧"
      />

      <Input
        ref={passwordRef as any}
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Enter your password"
        secureTextEntry={!showPw}
        autoCapitalize="none"
        autoComplete="password"
        returnKeyType="go"
        onSubmitEditing={handleLogin}
        onKeyPress={(e: any) => { if (e.nativeEvent?.key === "Enter" || e.key === "Enter") handleLogin(); }}
        leftIcon="🔒"
        right={
          <TouchableOpacity onPress={() => setShowPw(!showPw)} activeOpacity={0.7}>
            <Text style={f.showHide}>{showPw ? "HIDE" : "SHOW"}</Text>
          </TouchableOpacity>
        }
      />

      <TouchableOpacity onPress={handleReset} disabled={resetLoading} style={f.forgotRow} activeOpacity={0.7}>
        {resetLoading ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : resetSent ? (
          <Text style={f.resetSent}>✓ Reset email sent!</Text>
        ) : (
          <Text style={f.forgot}>Forgot password?</Text>
        )}
      </TouchableOpacity>

      <Button label="Sign In" onPress={handleLogin} fullWidth loading={loading} size="lg" />
    </View>
  );

  const registerLinkJsx = (
    <View style={f.registerRow}>
      <Text style={f.registerText}>Don't have an account? </Text>
      <TouchableOpacity onPress={() => router.push("/(auth)/register")} activeOpacity={0.7}>
        <Text style={f.registerLink}>Create Account</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Desktop: two-column ───────────────────────────────────────────────────
  if (isXWide) {
    return (
      <View style={[f.root, { flexDirection: "row" }]}>
        {/* Left decorative panel */}
        <View style={f.desktopLeft}>
          <View style={f.desktopLeftInner}>
            <View style={f.logoRing}>
              <LogoImage />
            </View>
            <Text style={f.desktopBrand}>{BRAND.appName}</Text>
            <Text style={f.desktopTagline}>
              {"Group savings, loans and investments — "}
              <Text style={{ color: "#4ade80" }}>{"all in one place."}</Text>
            </Text>
            <View style={f.desktopFeatures}>
              {["💰 Savings tracking", "🏦 Loan management", "📈 Investments", "👥 Member tools"].map((t, i) => (
                <View key={i} style={f.desktopFeatureRow}>
                  <View style={f.desktopFeatureDot} />
                  <Text style={f.desktopFeatureText}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Right: form */}
        <View style={f.desktopRight}>
          <View style={f.desktopCard}>
            <TouchableOpacity onPress={() => router.back()} style={f.back} activeOpacity={0.7}>
              <Text style={f.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={f.cardTitle}>Welcome back</Text>
            <Text style={f.cardSub}>Sign in to your account</Text>
            {formJsx}
            {registerLinkJsx}
          </View>
        </View>

        <Toast />
      </View>
    );
  }

  // ── Tablet: centered card ─────────────────────────────────────────────────
  if (isWide) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[f.root, { alignItems: "center", justifyContent: "center" }]}
      >
        <ScrollView
          contentContainerStyle={f.tabletScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={f.tabletCard}>
            <TouchableOpacity onPress={() => router.back()} style={f.back} activeOpacity={0.7}>
              <Text style={f.backText}>← Back</Text>
            </TouchableOpacity>

            <View style={f.tabletBrand}>
              <View style={f.logoRing}>
                <LogoImage />
              </View>
              <View>
                <Text style={f.cardTitle}>{BRAND.appName}</Text>
                <Text style={f.cardSub}>Welcome back — sign in to continue</Text>
              </View>
            </View>

            {formJsx}
            {registerLinkJsx}
          </View>
        </ScrollView>
        <Toast />
      </KeyboardAvoidingView>
    );
  }

  // ── Mobile: full-screen ───────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={f.root}
    >
      <ScrollView
        contentContainerStyle={f.mobileScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={f.back} activeOpacity={0.7}>
          <Text style={f.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={f.mobileBrand}>
          <View style={f.logoRing}>
            <LogoImage />
          </View>
          <Text style={f.cardTitle}>{BRAND.appName}</Text>
          <Text style={f.cardSub}>Welcome back</Text>
        </View>

        {formJsx}
        {registerLinkJsx}
      </ScrollView>
      <Toast />
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const f = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // Mobile
  mobileScroll: {
    flexGrow: 1,
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 60 : 44,
    paddingBottom: 40,
  },

  // Tablet
  tabletScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    minHeight: "100%",
  },
  tabletCard: {
    width: "100%" as any,
    maxWidth: 480,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 36,
    ...(Platform.OS === "web" ? {
      boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
    } : {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 20,
      elevation: 12,
    }) as any,
  },
  tabletBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 28,
  },

  // Desktop two-col
  desktopLeft: {
    flex: 1,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    padding: 60,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  desktopLeftInner: { maxWidth: 360, width: "100%" as any },
  desktopBrand: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  desktopTagline: {
    fontSize: 20,
    fontWeight: "500",
    color: Colors.text2,
    lineHeight: 30,
    marginBottom: 32,
  },
  desktopFeatures: { gap: 12 },
  desktopFeatureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  desktopFeatureDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  desktopFeatureText: { fontSize: 14, color: Colors.text2, fontWeight: "500" },
  desktopRight: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 60,
  },
  desktopCard: {
    width: "100%" as any,
    maxWidth: 420,
  },

  // Shared brand / logo
  logoRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryFaint,
    borderWidth: 1.5,
    borderColor: Colors.primary + "44",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    ...(Platform.OS !== "web" ? {
      shadowColor: Colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.20,
      shadowRadius: 12,
      elevation: 6,
    } : {}),
  },
  mobileBrand: { alignItems: "center", marginBottom: 36 },
  cardTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  cardSub: { fontSize: 14, color: Colors.text3 },

  // Back button
  back: { marginBottom: 24, alignSelf: "flex-start" },
  backText: { color: Colors.text3, fontSize: 14, fontWeight: "600" },

  // Form
  form: { marginBottom: 20 },
  showHide: { color: Colors.accent, fontSize: 12, fontWeight: "700" },
  forgotRow: { alignSelf: "flex-end", marginTop: 8, marginBottom: 16, minHeight: 20, justifyContent: "center" },
  forgot:    { color: Colors.accent, fontSize: 13, fontWeight: "600" },
  resetSent: { color: Colors.success, fontSize: 13, fontWeight: "600" },

  // Footer register link
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    paddingVertical: 8,
  },
  registerText: { color: Colors.text3, fontSize: 13 },
  registerLink: { color: Colors.accent, fontSize: 13, fontWeight: "700" },
});
