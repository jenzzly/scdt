// components/AutoLogoutGate.tsx
//
// Wrap the authenticated part of the app with this ONCE, at the root
// (app/_layout.tsx), around the <Stack />, so modal routes are covered too:
//
//   <AutoLogoutGate>
//     <Stack ... />
//   </AutoLogoutGate>
//
// After 5 minutes without interaction it signs out of Firebase, clears the
// store and returns to the welcome screen.
import React, { useCallback } from "react";
import { Alert, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useStore } from "../stores/useStore";
import { activityTouchHandlers, useInactivityLogout } from "../hooks/useInactivityLogout";

export function AutoLogoutGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const authUid = useStore((s) => s.authUid);
  const reset = useStore((s) => s.reset);

  const handleTimeout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // Even if Firebase sign-out fails (e.g. offline), clear local state.
    }
    reset();
    router.replace("/(auth)/welcome");

    const message = "You were signed out after 5 minutes of inactivity.";
    if (Platform.OS === "web") {
      window.alert(message);
    } else {
      Alert.alert("Signed out", message);
    }
  }, [reset, router]);

  useInactivityLogout({
    enabled: !!authUid,
    onTimeout: handleTimeout,
  });

  return (
    <View style={{ flex: 1 }} {...activityTouchHandlers}>
      {children}
    </View>
  );
}

export default AutoLogoutGate;
