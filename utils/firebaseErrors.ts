// Translate Firebase / Firestore errors into messages safe to show users.
// Never surface raw codes like "FirebaseError: [code=permission-denied]".

export function toUserFacingError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error == null) return fallback;

  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const raw = error instanceof Error ? error.message : String(error);
  const lower = `${code} ${raw}`.toLowerCase();

  if (code === "auth/email-already-in-use" || lower.includes("email-already-in-use")) {
    return "This email already has an account. Ask the user to sign in or use the invitation/linking process.";
  }
  if (code === "auth/invalid-email" || lower.includes("invalid-email")) {
    return "Enter a valid email address.";
  }
  if (code === "auth/weak-password" || lower.includes("weak-password")) {
    return "Password is too weak. Use at least 6 characters.";
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Invalid email or password.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please try again later.";
  }
  if (code === "auth/network-request-failed" || lower.includes("network")) {
    return "Network error. Check your connection and try again.";
  }
  if (code === "auth/user-disabled") {
    return "This account has been disabled. Contact your group administrator.";
  }
  if (code === "auth/session-expired" || lower.includes("session-expired")) {
    return "Your session has expired. Please sign in again.";
  }
  if (lower.includes("permission-denied") || lower.includes("missing or insufficient permissions")) {
    return "You don't have permission to perform this action.";
  }
  if (lower.includes("not-found") || lower.includes("document not found")) {
    return "The requested record was not found.";
  }
  if (lower.includes("already exists") || lower.includes("already-exists")) {
    return "That record already exists.";
  }
  if (lower.includes("failed-precondition")) {
    return "This action cannot be completed due to the current state.";
  }
  if (lower.includes("unauthenticated")) {
    return "You need to sign in to perform this action.";
  }
  if (lower.includes("deadline-exceeded")) {
    return "The request took too long. Please try again.";
  }
  if (lower.includes("aborted")) {
    return "The operation was cancelled.";
  }
  if (raw && !raw.toLowerCase().includes("firebase") && raw.length < 160) {
    return raw;
  }
  return fallback;
}
