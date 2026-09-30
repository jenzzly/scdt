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
      <Stack.Screen name="register" />
    </Stack>
  );
}