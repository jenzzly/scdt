// app/index.tsx
import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../hooks/useAuth";
import { useStore } from "../stores/useStore";
import { Colors } from "../utils/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { authUid } = useStore();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const onboardingCompleted = await AsyncStorage.getItem("onboarding_completed");
        setHasSeenOnboarding(onboardingCompleted === "true");
      } catch (error) {
        setHasSeenOnboarding(false);
      }
    };
    checkOnboarding();
  }, []);

  useEffect(() => {
    if (loading || hasSeenOnboarding === null) return;
    
    if (user || authUid) {
      router.replace("/(tabs)/dashboard");
    } else if (!hasSeenOnboarding) {
      router.replace("/(auth)/onboarding");
    } else {
      router.replace("/(auth)/welcome");
    }
  }, [user, loading, authUid, hasSeenOnboarding]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color={Colors.accent} />
    </View>
  );
}