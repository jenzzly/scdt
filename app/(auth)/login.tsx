// app/(auth)/login.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
  TextInput as RNTextInput,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../hooks/useAuth";
import { useStore } from "../../stores/useStore";
import { Input, Button, useToast } from "../../components/ui";
import { Colors, S, R, fmtCurrency } from "../../utils/theme";
import { BRAND } from "../../lib/brand";
import { FIXED_GROUP_ID } from "../../stores/fixedGroup";
import * as FS from "../../lib/firestore";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, resetPassword } = useAuth();
  const { show, Toast } = useToast();
  const { setActiveGroup, recalcTotals } = useStore();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showPw, setShowPw] = useState(false);
  
  const passwordInputRef = useRef<RNTextInput>(null);
  const emailInputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    if (Platform.OS === "web" && emailInputRef.current) {
      setTimeout(() => emailInputRef.current?.focus(), 100);
    }
  }, []);

  const handleLogin = async () => {
    if (!email.trim()) {
      show("Email address is required", "error");
      emailInputRef.current?.focus();
      return;
    }
    if (!password) {
      show("Password is required", "error");
      passwordInputRef.current?.focus();
      return;
    }
    
    setLoading(true);
    try {
      const user = await signIn(email.trim(), password);
      
      // Use ensureMemberExists which handles merging internally
      const member = await FS.ensureMemberExists(
        FIXED_GROUP_ID,
        user.uid,
        user.displayName || email.trim(),
        email.trim()
      );
      
      if (member && member.totalContributions > 0) {
        console.log("[Login] Existing member found with historical data:", member.totalContributions);
        show(`Welcome back! Your balance is ${fmtCurrency(member.totalContributions)}`, "success");
      } else if (member) {
        console.log("[Login] New member created");
      }
      
      // Recalculate totals to show historical data
      recalcTotals();
      
      setActiveGroup(FIXED_GROUP_ID);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      let msg = "Login failed. Try again.";
      if (e?.code === "auth/invalid-credential") {
        msg = "Invalid email or password";
      } else if (e?.code === "auth/user-not-found") {
        msg = "No account found with this email";
      } else if (e?.code === "auth/too-many-requests") {
        msg = "Too many failed attempts. Try again later";
      }
      show(msg, "error");
      passwordInputRef.current?.focus();
    } finally { 
      setLoading(false); 
    }
  };

  const handleResetPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      show("Enter your email address first", "error");
      emailInputRef.current?.focus();
      return;
    }
    
    setResetLoading(true);
    setResetSent(false);
    try {
      await resetPassword(trimmedEmail);
      setResetSent(true);
      show("Password reset email sent! Check your inbox.", "success");
    } catch (e: any) {
      let msg = "Failed to send reset email. Try again.";
      if (e?.code === "auth/user-not-found") {
        msg = "No account found with this email";
      } else if (e?.code === "auth/invalid-email") {
        msg = "Enter a valid email address";
      }
      show(msg, "error");
    } finally { 
      setResetLoading(false); 
    }
  };

  const handleKeyPress = (e: any) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"} 
      style={{ flex: 1, backgroundColor: Colors.bg }}
    >
      <ScrollView 
        contentContainerStyle={styles.container} 
        keyboardShouldPersistTaps="handled" 
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.brandSection}>
          <View style={styles.logoWrapper}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>S</Text>
            </View>
          </View>
          <Text style={styles.brandTitle}>{BRAND.appName}</Text>
          <Text style={styles.brandSubtitle}>Welcome back</Text>
        </View>

        <View style={styles.formSection}>
          <Input
            ref={emailInputRef}
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            leftIcon="📧"
          />
          
          <Input
            ref={passwordInputRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            onKeyPress={handleKeyPress}
            leftIcon="🔒"
            right={
              <TouchableOpacity onPress={() => setShowPw(!showPw)} activeOpacity={0.7}>
                <Text style={styles.showHideText}>
                  {showPw ? "HIDE" : "SHOW"}
                </Text>
              </TouchableOpacity>
            }
          />

          <TouchableOpacity 
            onPress={handleResetPassword} 
            disabled={resetLoading} 
            style={styles.forgotLink} 
            activeOpacity={0.7}
          >
            {resetLoading ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : resetSent ? (
              <Text style={styles.resetSentText}>✓ Reset email sent!</Text>
            ) : (
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
            )}
          </TouchableOpacity>

          <Button 
            label="Sign In" 
            onPress={handleLogin} 
            fullWidth 
            loading={loading} 
            size="lg" 
            style={styles.signInButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/register")} activeOpacity={0.7}>
            <Text style={styles.registerLink}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Toast />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 40,
  },
  backButton: {
    marginBottom: 24,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: Colors.text3,
    fontSize: 14,
    fontWeight: "600",
  },
  brandSection: {
    alignItems: "center",
    marginBottom: 40,
  },
  logoWrapper: {
    marginBottom: 20,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  logoText: {
    fontSize: 40,
    fontWeight: "800",
    color: "#fff",
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  brandSubtitle: {
    fontSize: 14,
    color: Colors.text3,
  },
  formSection: {
    marginBottom: 24,
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: 8,
    marginBottom: 16,
  },
  forgotLinkText: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "600",
  },
  resetSentText: {
    color: Colors.success,
    fontSize: 13,
    fontWeight: "600",
  },
  showHideText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  signInButton: {
    marginTop: 8,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 16,
  },
  footerText: {
    color: Colors.text3,
    fontSize: 13,
  },
  registerLink: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
});