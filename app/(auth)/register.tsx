// app/(auth)/register.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
  TextInput as RNTextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../hooks/useAuth";
import { useStore } from "../../stores/useStore";
import { Input, Button, useToast } from "../../components/ui";
import { Colors, S, R, fmtCurrency } from "../../utils/theme";
import { BRAND } from "../../lib/brand";
import { FIXED_GROUP_ID } from "../../stores/fixedGroup";
import * as FS from "../../lib/firestore";

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const { show, Toast } = useToast();
  const { setActiveGroup, recalcTotals } = useStore();
  
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  
  const emailInputRef = useRef<RNTextInput>(null);
  const passwordInputRef = useRef<RNTextInput>(null);
  const confirmPasswordInputRef = useRef<RNTextInput>(null);

  const handleRegister = async () => {
    if (!fullName.trim()) {
      show("Full name is required", "error");
      return;
    }
    if (!email.trim()) {
      show("Email address is required", "error");
      emailInputRef.current?.focus();
      return;
    }
    if (password.length < 6) {
      show("Password must be at least 6 characters", "error");
      passwordInputRef.current?.focus();
      return;
    }
    if (password !== confirmPassword) {
      show("Passwords do not match", "error");
      confirmPasswordInputRef.current?.focus();
      return;
    }
    
    setLoading(true);
    try {
      const user = await signUp(email.trim(), password, fullName.trim());
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Use ensureMemberExists which handles both new and existing members
      const member = await FS.ensureMemberExists(
        FIXED_GROUP_ID,
        user.uid,
        fullName.trim(),
        email.trim()
      );
      
      if (member && member.totalContributions > 0) {
        console.log("[Register] Existing member found! Historical data preserved:", member.totalContributions);
        show(`Welcome back! Your balance of ${fmtCurrency(member.totalContributions)} has been restored.`, "success");
      } else if (member) {
        console.log("[Register] New member created");
        show("Account created successfully!", "success");
      }
      
      recalcTotals();
      setActiveGroup(FIXED_GROUP_ID);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      let msg = "Registration failed. Try again.";
      if (e?.code === "auth/email-already-in-use") {
        msg = "Email already in use. Please login instead.";
      } else if (e?.code === "auth/weak-password") {
        msg = "Password is too weak. Use at least 6 characters.";
      } else if (e?.code === "auth/invalid-email") {
        msg = "Enter a valid email address";
      }
      show(msg, "error");
    } finally { 
      setLoading(false); 
    }
  };

  const handleKeyPress = (e: any) => {
    if (e.key === 'Enter') {
      handleRegister();
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
          <Text style={styles.brandTitle}>Create Account</Text>
          <Text style={styles.brandSubtitle}>Join {BRAND.appName} today</Text>
        </View>

        <View style={styles.formSection}>
          <Input
            label="Full Name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="e.g. Jean Pierre Habimana"
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => emailInputRef.current?.focus()}
            leftIcon="👤"
          />
          
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
            placeholder="Min. 6 characters"
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
            leftIcon="🔒"
            right={
              <TouchableOpacity onPress={() => setShowPw(!showPw)} activeOpacity={0.7}>
                <Text style={styles.showHideText}>
                  {showPw ? "HIDE" : "SHOW"}
                </Text>
              </TouchableOpacity>
            }
          />
          
          <Input
            ref={confirmPasswordInputRef}
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter your password"
            secureTextEntry={!showConfirmPw}
            autoCapitalize="none"
            returnKeyType="go"
            onSubmitEditing={handleRegister}
            onKeyPress={handleKeyPress}
            leftIcon="🔒"
            right={
              <TouchableOpacity onPress={() => setShowConfirmPw(!showConfirmPw)} activeOpacity={0.7}>
                <Text style={styles.showHideText}>
                  {showConfirmPw ? "HIDE" : "SHOW"}
                </Text>
              </TouchableOpacity>
            }
          />

          <Button 
            label="Create Account" 
            onPress={handleRegister} 
            fullWidth 
            loading={loading} 
            size="lg" 
            style={styles.registerButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/login")} activeOpacity={0.7}>
            <Text style={styles.loginLink}>Sign In</Text>
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
    marginBottom: 32,
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
  showHideText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  registerButton: {
    marginTop: 8,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 16,
  },
  footerText: {
    color: Colors.text3,
    fontSize: 13,
  },
  loginLink: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
});