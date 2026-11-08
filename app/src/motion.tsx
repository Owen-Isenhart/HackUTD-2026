import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

// Strong ease-out for UI (animate skill). Never ease-in.
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** Animated value that eases to `target` whenever it changes. Transitions retarget from current value. */
export function useTimed(target: number, ms = 200, native = true) {
  const v = useRef(new Animated.Value(target)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    Animated.timing(v, { toValue: target, duration: reduce ? 0 : ms, easing: easeOut, useNativeDriver: native && true }).start();
  }, [target, ms, reduce, v, native]);
  return v;
}

/** One-shot 0 -> 1 reveal on mount (e.g. charts). Reduced motion: jumps to final state. */
export function useReveal(ms = 400, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: ms, delay, easing: easeOut, useNativeDriver: false }).start();
  }, [reduce, ms, delay, v]);
  return v;
}

/** Press feedback: scale to 0.97 in 120ms, release in 160ms. Skipped under reduced motion. */
export function PressScale({
  children,
  style,
  outerStyle,
  scaleTo = 0.97,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  outerStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const v = useRef(new Animated.Value(1)).current;
  const reduce = useReducedMotion();
  const to = (x: number, ms: number) =>
    Animated.timing(v, { toValue: x, duration: ms, easing: easeOut, useNativeDriver: true }).start();
  return (
    <Pressable
      {...rest}
      style={outerStyle}
      onPressIn={(e) => {
        if (!reduce) to(scaleTo, 120);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1, 160);
        rest.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
