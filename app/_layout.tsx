// _layout.tsx - Update the RootLayout component
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Colors } from "../utils/theme";
import { useStore } from "../stores/useStore";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = Font.useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const { recalcTotals } = useStore();

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
      if (recalcTotals && typeof recalcTotals === 'function') {
        recalcTotals();
      }
    }
  }, [fontsLoaded, recalcTotals]);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="dark" backgroundColor={Colors.surface} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modals/add-contribution" options={{ presentation: "modal" }} />
        <Stack.Screen name="modals/add-loan" options={{ presentation: "modal" }} />
        <Stack.Screen name="modals/add-investment" options={{ presentation: "modal" }} />
        <Stack.Screen name="modals/add-expense" options={{ presentation: "modal" }} />
        <Stack.Screen name="modals/add-meeting" options={{ presentation: "modal" }} />
        <Stack.Screen name="modals/record-repayment" options={{ presentation: "modal" }} />
        <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
        <Stack.Screen name="group-settings" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}