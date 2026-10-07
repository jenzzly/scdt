// app/(auth)/_layout.tsx
import { Stack } from "expo-router";
import { useTheme } from "../../hooks/useTheme";

export default function AuthLayout() {
  const C = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="login" />
      {/*
        `register` is deliberately NOT registered. Account creation
        now happens only via admin invite + password-reset email.
        The file is left on disk so the route can be re-enabled by
        restoring this line — nothing else depends on it being
        hidden.
      */}
    </Stack>
  );
}