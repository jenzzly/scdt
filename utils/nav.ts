// utils/navigation.ts
import { Router } from "expo-router";

export function safeGoBack(
  router: Pick<Router, "canGoBack" | "back" | "replace">,
  fallback: string = "/"
) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback as any);
  }
}