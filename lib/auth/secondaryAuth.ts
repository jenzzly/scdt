// lib/auth/secondaryAuth.ts
//
// A named secondary Firebase App + Auth instance so an admin can create
// another email/password account without replacing the primary session.
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  type Auth,
} from "firebase/auth";
import { firebaseConfig } from "../firebase";

const SECONDARY_APP_NAME = "scdt-secondary";

let secondaryAuth: Auth | null = null;

export function getSecondaryAuth(): Auth {
  if (secondaryAuth) return secondaryAuth;
  const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  const secondaryApp = existing ?? initializeApp(firebaseConfig, SECONDARY_APP_NAME);
  secondaryAuth = getAuth(secondaryApp);
  return secondaryAuth;
}

export async function createUserWithSecondaryAuth(
  email: string,
  password: string,
): Promise<{ uid: string; email: string }> {
  const secondary = getSecondaryAuth();
  try {
    const cred = await createUserWithEmailAndPassword(secondary, email.trim(), password);
    return {
      uid: cred.user.uid,
      email: cred.user.email || email.trim(),
    };
  } finally {
    try {
      await firebaseSignOut(secondary);
    } catch {
      // Primary admin session must remain; ignore secondary sign-out errors.
    }
  }
}

export async function sendPasswordResetWithSecondaryAuth(email: string): Promise<void> {
  await sendPasswordResetEmail(getSecondaryAuth(), email.trim());
}
