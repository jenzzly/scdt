// lib/auth/password.ts
//
// Password reset uses Firebase Authentication only (never Resend, never
// stored passwords). Success is always generic so we do not reveal whether
// an account exists.
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for this email, a password reset email has been sent.";

export async function sendPasswordReset(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error("Enter your email address first");
  }
  try {
    await sendPasswordResetEmail(auth, trimmed);
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code === "auth/user-not-found" || code === "auth/invalid-email") {
      return;
    }
    throw error;
  }
}
