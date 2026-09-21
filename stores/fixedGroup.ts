// stores/fixedGroup.ts
//
// Fixed group ID used for the application. This is the single group
// that all users belong to in this deployment.
//
// For single-group deployments, this ID is constant and known.
// For multi-group deployments, this would be replaced with a
// dynamic group selection system.
//
// The env-var warning that used to fire when EXPO_PUBLIC_FIXED_GROUP_ID
// was unset has been removed. The fallback value below is the correct
// value for this deployment, so the warning was pure noise on every
// app start. If a future deployment needs a different group ID, set
// the env var — the fallback here is unchanged.

export const FIXED_GROUP_ID =
  process.env.EXPO_PUBLIC_FIXED_GROUP_ID || "scdt-main-group";