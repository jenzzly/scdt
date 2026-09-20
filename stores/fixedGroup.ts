// stores/fixedGroup.ts
//
// Fixed group ID used for the application. This is the single group
// that all users belong to in this deployment.
//
// For single-group deployments, this ID is constant and known.
// For multi-group deployments, this would be replaced with a
// dynamic group selection system.

export const FIXED_GROUP_ID =
  process.env.EXPO_PUBLIC_FIXED_GROUP_ID || "scdt-main-group";

if (!process.env.EXPO_PUBLIC_FIXED_GROUP_ID) {
  console.warn(
    `[fixedGroup] EXPO_PUBLIC_FIXED_GROUP_ID not set — falling back to "${FIXED_GROUP_ID}". ` +
    "Set the env var if this deployment should use a different group ID.",
  );
}