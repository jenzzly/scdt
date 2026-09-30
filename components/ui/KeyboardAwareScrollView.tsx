// components/ui/KeyboardAwareScrollView.tsx
//
// Drop-in ScrollView that keeps the focused TextInput visible above the
// on-screen keyboard on iOS and Android. Use it for any form body — page
// content, or the ScrollView inside a BottomModal.
//
// What it does when the keyboard opens:
//   1. Adds the keyboard's height as bottom padding, so there is always
//      enough scroll room to lift the last field above the keyboard.
//   2. Measures the focused input and scrolls just far enough that it sits
//      `extraScrollHeight` px above the top of the keyboard.
//   3. Repeats (2) when the user taps a different input while the keyboard
//      is already open (no keyboard event fires in that case).
//
// It also defaults keyboardShouldPersistTaps="handled" (buttons work on the
// first tap while the keyboard is up) and dismisses the keyboard on drag.
//
// On web the browser already scrolls a focused input into view, so this
// renders a plain ScrollView there.
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  TextInput,
} from "react-native";

const ENABLED = Platform.OS !== "web";
const SHOW_EVENT = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE_EVENT = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

/** Current keyboard height (0 when hidden). Handy for custom sheets/footers. */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ENABLED) return;
    const show = Keyboard.addListener(SHOW_EVENT, (e: KeyboardEvent) =>
      setHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener(HIDE_EVENT, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Gap kept between the focused input and the top of the keyboard. */
  extraScrollHeight?: number;
}

export const KeyboardAwareScrollView = forwardRef<
  ScrollView,
  KeyboardAwareScrollViewProps
>(function KeyboardAwareScrollView(
  {
    contentContainerStyle,
    extraScrollHeight = 24,
    onScroll,
    onTouchEndCapture,
    keyboardShouldPersistTaps = "handled",
    keyboardDismissMode,
    children,
    ...rest
  },
  ref
) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [kbHeight, setKbHeight] = useState(0);

  useImperativeHandle(ref, () => scrollRef.current as ScrollView);

  const revealFocusedInput = useCallback(() => {
    const top = keyboardTop.current;
    if (top == null) return;

    const state: any = (TextInput as any).State;
    const input: any = state?.currentlyFocusedInput?.();
    if (!input?.measureInWindow) return;

    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const overlap = y + h + extraScrollHeight - top;
      if (overlap > 0) {
        scrollRef.current?.scrollTo({
          y: scrollY.current + overlap,
          animated: true,
        });
      }
    });
  }, [extraScrollHeight]);

  useEffect(() => {
    if (!ENABLED) return;

    const show = Keyboard.addListener(SHOW_EVENT, (e: KeyboardEvent) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKbHeight(e.endCoordinates.height);
      // Give the extra bottom padding a moment to lay out first, otherwise
      // there may not be enough scroll range yet.
      setTimeout(revealFocusedInput, 100);
    });

    const hide = Keyboard.addListener(HIDE_EVENT, () => {
      keyboardTop.current = null;
      setKbHeight(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [revealFocusedInput]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  if (!ENABLED) {
    return (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onScroll={onScroll}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  }

  const flat = StyleSheet.flatten(contentContainerStyle) || {};
  const basePadding =
    typeof flat.paddingBottom === "number"
      ? flat.paddingBottom
      : typeof flat.padding === "number"
      ? flat.padding
      : 0;

  return (
    <ScrollView
      ref={scrollRef}
      {...rest}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={
        keyboardDismissMode ?? (Platform.OS === "ios" ? "interactive" : "on-drag")
      }
      scrollEventThrottle={16}
      onScroll={handleScroll}
      onTouchEndCapture={(e) => {
        // Tapping another input while the keyboard is already open fires no
        // keyboard event — re-check after focus has moved.
        if (keyboardTop.current != null) setTimeout(revealFocusedInput, 120);
        onTouchEndCapture?.(e);
      }}
      contentContainerStyle={[
        contentContainerStyle,
        kbHeight > 0 && { paddingBottom: basePadding + kbHeight },
      ]}
    >
      {children}
    </ScrollView>
  );
});

export default KeyboardAwareScrollView;
