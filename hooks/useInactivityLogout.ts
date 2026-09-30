// hooks/useInactivityLogout.ts
//
// Signs the user out after a period with no interaction (default 5 min).
//
// "Activity" = any touch / click / key press / scroll, or the keyboard
// opening. Sources:
//   • Native : touch-capture handlers on the root view (see
//              `activityTouchHandlers` / AutoLogoutGate). Capture handlers
//              only observe — they never claim the gesture from children.
//   • Web    : document-level listeners.
//   • Native <Modal>s (e.g. BottomModal) render in their own window, so
//     touches inside them never reach the root view — they call
//     `markActivity()` directly.
//
// Backgrounding: JS timers are paused while the app is suspended, so the
// timeout can't be trusted to fire. Instead we remember when the user was
// last active and, when the app returns to the foreground, sign out
// immediately if the gap is >= the timeout.
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard, Platform } from "react-native";

export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

// ── Global activity bus ────────────────────────────────────────────────
const listeners = new Set<() => void>();

/** Call from anywhere (e.g. inside a native Modal) to say "user is active". */
export function markActivity() {
  listeners.forEach((fn) => fn());
}

/**
 * Spread onto the root <View>. Module-level constants, so nothing here
 * reads refs or impure values during render.
 */
export const activityTouchHandlers = {
  onTouchStartCapture: markActivity,
  onTouchMoveCapture: markActivity,
};

export function useInactivityLogout({
  enabled,
  onTimeout,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
}: {
  enabled: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
}) {
  // Real timestamps are assigned inside effects/handlers (never during render).
  const lastActive = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    clearTimer();
    onTimeoutRef.current();
  }, []);

  const arm = useCallback(() => {
    clearTimer();
    const remaining = Math.max(0, timeoutMs - (Date.now() - lastActive.current));
    timer.current = setTimeout(fire, remaining);
  }, [timeoutMs, fire]);

  const touch = useCallback(() => {
    if (!enabled || firedRef.current) return;
    const now = Date.now();
    // Throttle: high-frequency events (scroll/mousemove) only need to
    // push the deadline out, not reset a timer 60 times a second.
    if (now - lastActive.current < 1000 && timer.current) return;
    lastActive.current = now;
    arm();
  }, [enabled, arm]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }
    firedRef.current = false;
    lastActive.current = Date.now();
    arm();

    listeners.add(touch);

    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (Date.now() - lastActive.current >= timeoutMs) fire();
        else arm();
      }
    });

    const kbSub = Keyboard.addListener("keyboardDidShow", touch);

    const webEvents = ["mousedown", "keydown", "touchstart", "wheel", "scroll", "mousemove"];
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (Date.now() - lastActive.current >= timeoutMs) fire();
        else arm();
      }
    };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      webEvents.forEach((e) => document.addEventListener(e, touch, { passive: true, capture: true }));
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      clearTimer();
      listeners.delete(touch);
      appSub.remove();
      kbSub.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        webEvents.forEach((e) => document.removeEventListener(e, touch, true));
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, timeoutMs, arm, fire, touch]);
}
