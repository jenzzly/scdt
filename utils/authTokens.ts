// utils/authTokens.ts
//
// Stub for the removed token-based login flow. The real implementation
// was deleted in favour of admin-initiated account creation:
//
//   1. Admin adds the member (Members screen → Add member).
//   2. Admin hits "Reset Password" on that member.
//   3. lib/auth/adminUsers.ts creates the Firebase Auth account
//      if it doesn't exist, then sends a password-reset email.
//   4. Member clicks the emailed link, sets a password, and signs
//      in through the normal login screen.
//
// The stub below exists so the still-present call sites in
// app/group-settings.tsx (the Token Requests tab, currently
// commented out of the tab bar) compile. If that code path is ever
// re-enabled without restoring the real implementation, the throw
// fires immediately rather than silently returning a fake token.
export function generateLoginToken(): {
  token: string;
  expiry: string;
} {
  throw new Error(
    "Token-based login is disabled. Use Members → Reset Password " +
      "to send the member a login link instead.",
  );
}
