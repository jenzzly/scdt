// app/(auth)/_layout.tsx
import { Stack } from "expo-router";
import { Colors } from "../../utils/theme";

export default function AuthLayout() {
  return (
    <Stack 
      screenOptions={{ 
        headerShown: false, 
        contentStyle: { backgroundColor: Colors.bg },
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