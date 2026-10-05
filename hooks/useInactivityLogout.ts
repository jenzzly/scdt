// hooks/useInactivityLogout.ts
//
// Signs the user out after a period with no interaction (default 5
// minutes), on web and mobile.
//
// MECHANISM
//   A single setInterval polls Date.now() - lastActive every few
//   seconds. When the gap reaches timeoutMs, it fires onTimeout.
//   There is no one-shot setTimeout involved — the previous version
//   relied on one and it could be silently dropped (hot reload
//   mid-arm, effect teardown, stale deps) with no error, which is
//   why the app sometimes never logged out.
//
// ACTIVITY SOURCES
//   • Native : touch-capture handlers on the root View (via
//              activityTouchHandlers / AutoLogoutGate). Capture
//              handlers only observe; they never claim a gesture.
//   • Web    : document-level mousedown, keydown, touchstart, wheel,
//              scroll, mousemove listeners. All passive + capture.
//   • Native <Modal>s render in their own window, so touches inside
//     them never reach the root View — they call markActivity().
//   • Backgrounding: JS timers pause while the app is suspended.
//     On return to foreground, AppState compares wall-clock elapsed
//     to lastActive and fires immediately if the gap is past the
//     timeout.
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard, Platform } from "react-native";

export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

// ── Global activity bus ────────────────────────────────────────────────
const listeners = new Set<() => void>();

/** Call from anywhere (e.g. inside a native Modal) to say "user is active". */
export function markActivity() {
  listeners.forEach((fn) => fn());
}

/** Spread onto the root <View>. Capture-only — never claims a gesture. */
export const activityTouchHandlers = {
  onTouchStartCapture: markActivity,
  onTouchMoveCapture: markActivity,
};

export function useInactivityLogout({
  enabled,
  onTimeout,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
  debug = false,
}: {
  enabled: boolean;
  onTimeout: () => void;
  timeoutMs?: number;
  /** When true, logs arm / fire events to the console. */
  debug?: boolean;
}) {
  const lastActive = useRef(0);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);

  // Keep the latest callback without re-arming the interval every
  // render the caller re-creates it (which is why the timeout used
  // to disappear without warning).
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) console.log("[inactivity]", ...args);
    },
    [debug],
  );

  const touch = useCallback(() => {
    if (firedRef.current) return;
    lastActive.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) {
      log("disabled");
      return;
    }

    firedRef.current = false;
    lastActive.current = Date.now();
    log("armed, timeoutMs =", timeoutMs);

    // Poll every few seconds. Two caps: never tick faster than 1s
    // (avoids burning a timer on very short test timeouts), never
    // slower than 5s (so a 5-minute timeout fires within 5s of the
    // deadline in the worst case).
    const tickMs = Math.min(5000, Math.max(1000, Math.floor(timeoutMs / 12)));

    const interval = setInterval(() => {
      if (firedRef.current) return;
      const elapsed = Date.now() - lastActive.current;
      if (elapsed >= timeoutMs) {
        firedRef.current = true;
        log("firing; elapsed =", elapsed);
        try {
          onTimeoutRef.current();
        } catch (e) {
          console.warn("[inactivity] onTimeout threw:", e);
        }
      }
    }, tickMs);

    listeners.add(touch);

    const appSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (firedRef.current) return;
      if (Date.now() - lastActive.current >= timeoutMs) {
        firedRef.current = true;
        log("firing on foreground; gap exceeded timeout");
        try {
          onTimeoutRef.current();
        } catch (e) {
          console.warn("[inactivity] onTimeout threw:", e);
        }
      }
    });

    const kbSub = Keyboard.addListener("keyboardDidShow", touch);

    const webEvents = [
      "mousedown",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
      "mousemove",
    ];
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (firedRef.current) return;
      if (Date.now() - lastActive.current >= timeoutMs) {
        firedRef.current = true;
        log("firing on tab return; gap exceeded timeout");
        try {
          onTimeoutRef.current();
        } catch (e) {
          console.warn("[inactivity] onTimeout threw:", e);
        }
      }
    };

    if (Platform.OS === "web" && typeof document !== "undefined") {
      webEvents.forEach((e) =>
        document.addEventListener(e, touch, { passive: true, capture: true }),
      );
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      clearInterval(interval);
      listeners.delete(touch);
      appSub.remove();
      kbSub.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        webEvents.forEach((e) => document.removeEventListener(e, touch, true));
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, timeoutMs, touch, log]);
}
