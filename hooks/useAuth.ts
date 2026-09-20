// hooks/useAuth.ts
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
    // setAuth and clearAuth are Zustand action refs and are stable across
    // renders, so including them here won't cause resubscribes. Declared
    // explicitly to keep the effect self-documenting.
  }, [setAuth, clearAuth]);

  const signIn = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  };

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(cred.user, { displayName });

    // Force reload so `auth.currentUser` reflects the just-set
    // displayName before callers read it.
    await cred.user.reload();
    const reloadedUser = auth.currentUser;

    setAuth(cred.user.uid, displayName, email);

    return reloadedUser || cred.user;
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    clearAuth();
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return { user, loading, signIn, signUp, signOut, resetPassword };
}