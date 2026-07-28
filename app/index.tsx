// app/index.tsx
// Default route — redirects to login when unauthenticated,
// to dashboard when authenticated. Login is always the public entry point.
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../hooks/useAuth";
import { useStore } from "../stores/useStore";
import { Colors } from "../utils/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { authUid } = useStore();

  useEffect(() => {
    if (loading) return;
    if (user || authUid) {
      // Authenticated — go to app
      router.replace("/(tabs)/dashboard");
    } else {
      // Not authenticated — always go to login (not onboarding/welcome)
      router.replace("/(auth)/login");
    }
  }, [user, loading, authUid]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
