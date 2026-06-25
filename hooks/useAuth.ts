// useAuth.ts
import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  type User,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { useStore } from "../stores/useStore";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setAuth, clearAuth } = useStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        console.log("[Auth] State changed:", u ? `User: ${u.uid}` : "No user");
        setUser(u);
        setLoading(false);
        if (u) {
          setAuth(u.uid, u.displayName ?? u.email ?? "User", u.email ?? "");
        } else {
          clearAuth();
        }
      },
      (error) => {
        console.error("[Auth] onAuthStateChanged error:", error);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const signIn = async (email: string, password: string) => {
    console.log("[Auth] Signing in...");
    const cred = await signInWithEmailAndPassword(auth, email, password);
    console.log("[Auth] Sign in successful:", cred.user.uid);
    return cred.user;
  };

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    console.log("[Auth] Signing up...");

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("[Auth] Auth account created:", cred.user.uid);

    await updateProfile(cred.user, { displayName });
    console.log("[Auth] Display name set:", displayName);
    
    // Force reload to ensure displayName is available
    await cred.user.reload();
    const reloadedUser = auth.currentUser;
    
    setAuth(cred.user.uid, displayName, email);
    console.log("[Auth] Sign up successful:", cred.user.uid);
    
    return reloadedUser || cred.user;
  };

  const signOut = async () => {
    console.log("[Auth] Signing out...");
    await firebaseSignOut(auth);
    clearAuth();
    console.log("[Auth] Sign out successful");
  };

  const resetPassword = async (email: string) => {
    console.log("[Auth] Sending password reset to:", email);
    await sendPasswordResetEmail(auth, email);
    console.log("[Auth] Password reset email sent");
  };

  return { user, loading, signIn, signUp, signOut, resetPassword };
}