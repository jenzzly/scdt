// _layout.tsx - Update the RootLayout component
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
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

  // IMPORTANT: never return null/conditionally unmount here. Expo Router
  // requires the Root Layout to render a Navigator (Stack/Slot) on its
  // very first render. If this returns null while fonts load, any nested
  // screen that calls router.replace() in a useEffect during that window
  // (e.g. app/index.tsx and app/(tabs)/_layout.tsx both redirect based on
  // authUid on mount) throws:
  //   "Attempted to navigate before mounting the Root Layout component."
  // The native splash screen (preventAutoHideAsync above) already covers
  // the blank frame until fontsLoaded flips true and hideAsync() runs, so
  // we don't need to unmount the Stack to hide a flash of unstyled text.

  return (
    <SafeAreaProvider>
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
    </SafeAreaProvider>
  );
}