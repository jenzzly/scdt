// stores/fixedGroup.ts
//
// Fixed group ID used for the application. This is the single group
// that all users belong to in this deployment.
//
// For single-group deployments, this ID is constant and known.
// For multi-group deployments, this would be replaced with a
// dynamic group selection system.

export const FIXED_GROUP_ID = process.env.EXPO_PUBLIC_FIXED_GROUP_ID || "scdt-main-group";

// Verify the group ID is set
if (!process.env.EXPO_PUBLIC_FIXED_GROUP_ID) {
  console.warn(
    "[fixedGroup] EXPO_PUBLIC_FIXED_GROUP_ID not set, using 'default-group'. " +
    "This is fine for development, but for production you should set this environment variable."
  );
}