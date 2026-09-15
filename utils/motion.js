// utils/motion.js
//
// Shared animation primitives so every screen presses, enters, and exits
// the same way instead of each component hand-rolling its own timing.
// Pure RN `Animated` (matches the rest of the app — no reanimated/gesture-
// handler dependency to add).

import { useRef, useCallback, useEffect } from 'react';
import { Animated, Easing } from 'react-native';

// Springs tuned once, reused everywhere.
export const springs = {
  snappy: { useNativeDriver: true, speed: 40, bounciness: 6 },
  soft: { useNativeDriver: true, speed: 14, bounciness: 8 },
  gentle: { useNativeDriver: true, speed: 10, bounciness: 4 },
};

export const durations = {
  fast: 140,
  base: 220,
  slow: 340,
};

// Standard "press" feedback: scale down on press-in, spring back on
// press-out. Returned style spreads straight onto an Animated.View.
export function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = useCallback(() => {
    Animated.spring(scale, { toValue: to, ...springs.snappy }).start();
  }, [to]);
  const onPressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, ...springs.soft }).start();
  }, []);
  return { style: { transform: [{ scale }] }, onPressIn, onPressOut, scale };
}

// Fade + rise entrance for cards/rows/sections appearing on screen.
export function useEnter({ delay = 0, distance = 16 } = {}) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(distance)).current;
  const play = useCallback(() => {
    fade.setValue(0);
    rise.setValue(distance);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: durations.slow, delay, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.spring(rise, { toValue: 0, delay, ...springs.gentle }),
    ]).start();
  }, [delay, distance]);
  return { style: { opacity: fade, transform: [{ translateY: rise }] }, play };
}

// Horizontal shake — attach to a field/card to signal a rejected action
// (failed validation, wrong passcode) without a modal interrupting flow.
export function useShake() {
  const x = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    x.setValue(0);
    Animated.sequence([
      Animated.timing(x, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(x, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(x, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(x, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(x, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, []);
  return { style: { transform: [{ translateX: x }] }, shake };
}

// Looping opacity pulse — the "breathing" shimmer used by Skeleton.
export function useShimmer() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useRefEffectOnce(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  });
  return opacity;
}

function useRefEffectOnce(setup) {
  useEffect(setup, []);
}
