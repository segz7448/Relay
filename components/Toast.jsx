// components/Toast.jsx
//
// One toast queue for the whole app. Mount <ToastProvider> once at the
// root (see app/_layout.jsx); anywhere else, `const toast = useToast()`
// then `toast.show('Archived')` / `toast.success('Sent')` /
// `toast.error('Could not send', { actionLabel: 'Retry', onAction })`.
//
// Behavior: spring in from the top, auto-dismiss after a duration that
// scales with message length, swipe-up-to-dismiss, one toast visible at
// a time with the rest queued so rapid actions (bulk delete, multi-send)
// don't stack illegibly.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { radius, space, type, useTheme } from '../theme';
import { hapticTap, hapticBurst } from '../utils/haptics';
import { springs } from '../utils/motion';

const ToastContext = createContext(null);

const ICONS = {
  default: null,
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

let idSeq = 0;

export function ToastProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const advancing = useRef(false);

  const enqueue = useCallback((message, opts = {}) => {
    const item = { id: ++idSeq, message, kind: opts.kind || 'default', actionLabel: opts.actionLabel, onAction: opts.onAction, duration: opts.duration };
    if (item.kind === 'error') hapticBurst(); else hapticTap();
    setQueue((q) => [...q, item]);
  }, []);

  const api = useMemo(
    () => ({
      show: (message, opts) => enqueue(message, opts),
      success: (message, opts) => enqueue(message, { ...opts, kind: 'success' }),
      error: (message, opts) => enqueue(message, { ...opts, kind: 'error' }),
      info: (message, opts) => enqueue(message, { ...opts, kind: 'info' }),
    }),
    [enqueue]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost queue={queue} setQueue={setQueue} current={current} setCurrent={setCurrent} advancing={advancing} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft rather than crash a screen that renders before the
    // provider mounts (e.g. during fast refresh) — toasts are UX sugar,
    // never load-bearing.
    return { show: () => {}, success: () => {}, error: () => {}, info: () => {} };
  }
  return ctx;
}

function ToastHost({ queue, setQueue, current, setCurrent, advancing }) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef(null);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      setCurrent(null);
      advancing.current = false;
    });
  }, []);

  const present = useCallback((item) => {
    setCurrent(item);
    translateY.setValue(-120);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...springs.soft }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    clearTimeout(dismissTimer.current);
    const duration = item.duration ?? Math.min(5200, Math.max(2200, item.message.length * 60));
    dismissTimer.current = setTimeout(dismiss, duration);
  }, [dismiss]);

  // Advance the queue: nothing showing + something queued -> show it.
  if (!current && queue.length && !advancing.current) {
    advancing.current = true;
    const [next, ...rest] = queue;
    setQueue(rest);
    requestAnimationFrame(() => present(next));
  }

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_, g) => {
        if (g.dy < 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -24) {
          clearTimeout(dismissTimer.current);
          dismiss();
        } else {
          Animated.spring(translateY, { toValue: 0, ...springs.soft }).start();
        }
      },
    })
  ).current;

  if (!current) return null;
  const icon = ICONS[current.kind];
  const tint = current.kind === 'error' ? colors.danger : current.kind === 'success' ? colors.online : colors.textPrimary;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + space.xs, opacity, transform: [{ translateY }] }]}
    >
      <View {...pan.panHandlers} style={styles.clip}>
        <BlurView intensity={50} tint={scheme === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
        <View style={styles.tint} />
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={19} color={tint} style={{ marginRight: space.sm }} /> : null}
          <Text style={styles.message} numberOfLines={2}>{current.message}</Text>
          {current.actionLabel ? (
            <Pressable
              onPress={() => {
                clearTimeout(dismissTimer.current);
                current.onAction?.();
                dismiss();
              }}
              hitSlop={8}
              style={{ marginLeft: space.sm }}
            >
              <Text style={[styles.action, { color: colors.accent }]}>{current.actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 999, elevation: 999 },
    clip: {
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    tint: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface + 'CC' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
    message: { ...type.body, color: colors.textPrimary, flex: 1 },
    action: { ...type.body, fontWeight: '700' },
  });
}
