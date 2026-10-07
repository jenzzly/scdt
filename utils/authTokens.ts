// utils/authTokens.ts
//
// Intentionally empty. The token-based invite flow has been
// removed in favour of admin-initiated account creation:
//
//   1. Admin adds the member (Members screen → Add member).
//   2. Admin hits "Reset Password" on that member.
//   3. lib/auth/adminUsers.ts creates the Firebase Auth account
//      if it doesn't exist, then sends a password-reset email
//      via the secondary-auth instance.
//   4. Member clicks the emailed link, sets a password, and
//      signs in through the normal login screen.
//
// The file is kept (empty) so any stale import path resolves.
export {};
