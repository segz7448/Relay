// components/ConfirmDialog.jsx
//
// Centered iOS-alert-style confirmation, replacing ad-hoc Alert.alert
// calls so destructive actions (delete bot, sign out, clear history)
// get the same look, press feedback, and in-button loading state.
//
// Usage: const confirm = useConfirm();
//   const ok = await confirm({ title: 'Delete bot?', message: '…', destructive: true, confirmLabel: 'Delete' });
//   if (ok) { ... }
//
// If the caller passes `onConfirm` (can be async), the dialog stays open
// showing a spinner in the confirm button until it resolves, then closes
// itself — so the caller doesn't need a separate loading state.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { radius, space, type, useTheme } from '../theme';
import { hapticBurst, hapticTap } from '../utils/haptics';
import { springs } from '../utils/motion';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { title, message, ...opts, resolve }
  const [busy, setBusy] = useState(false);
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const present = useCallback((opts) => {
    scale.setValue(0.9);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, ...springs.snappy }),
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, []);

  const close = useCallback((result) => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.92, duration: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setState((s) => {
        s?.resolve?.(result);
        return null;
      });
      setBusy(false);
    });
  }, []);

  const ask = useCallback((opts) => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve });
      present();
    });
  }, [present]);

  async function handleConfirm() {
    hapticBurst();
    if (state?.onConfirm) {
      setBusy(true);
      try {
        await state.onConfirm();
        close(true);
      } catch (e) {
        // Leave the dialog open so the caller's onConfirm can decide to
        // retry — but stop the button spinner and surface it wasn't silent.
        setBusy(false);
        state.onError?.(e);
      }
    } else {
      close(true);
    }
  }

  function handleCancel() {
    hapticTap();
    close(false);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state ? (
        <ConfirmModal state={state} busy={busy} scale={scale} opacity={opacity} onConfirm={handleConfirm} onCancel={handleCancel} />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) return async () => false;
  return ctx;
}

function ConfirmModal({ state, busy, scale, opacity, onConfirm, onCancel }) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => getStyles(colors, scheme), [colors, scheme]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <BlurView
            pointerEvents="none"
            intensity={scheme === 'light' ? 40 : 50}
            tint={scheme === 'light' ? 'light' : 'dark'}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.tint} />
          {state.title ? <Text style={styles.title}>{state.title}</Text> : null}
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
          <View style={styles.buttonRow}>
            <DialogButton label={state.cancelLabel || 'Cancel'} onPress={onCancel} disabled={busy} styles={styles} />
            <View style={styles.divider} />
            <DialogButton
              label={state.confirmLabel || 'OK'}
              onPress={onConfirm}
              destructive={state.destructive}
              busy={busy}
              primary
              styles={styles}
              colors={colors}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function DialogButton({ label, onPress, destructive, busy, primary, disabled, styles, colors }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.timing(opacity, { toValue: 0.55, duration: 70, useNativeDriver: true }).start();
  const onPressOut = () => Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled || busy}
      style={styles.button}
    >
      <Animated.View style={{ opacity, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {busy ? (
          <PulsingDot color={destructive ? colors.danger : colors.accent} />
        ) : (
          <Text style={[styles.buttonLabel, primary && (destructive ? styles.destructiveLabel : styles.primaryLabel)]}>
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function PulsingDot({ color }) {
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 380, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, opacity: v }} />;
}

function getStyles(colors, scheme) {
  const isLight = scheme === 'light';
  return StyleSheet.create({
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: space.xl },
    card: {
      width: '100%',
      maxWidth: 300,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.10)',
      overflow: 'hidden',
      paddingTop: space.lg,
      paddingHorizontal: space.lg,
      shadowColor: '#000',
      shadowOpacity: isLight ? 0.1 : 0.35,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    tint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isLight ? 'rgba(255,255,255,0.42)' : 'rgba(24,28,33,0.46)',
    },
    title: { ...type.h2, color: colors.textPrimary, textAlign: 'center' },
    message: { ...type.small, color: colors.textSecondary, textAlign: 'center', marginTop: space.xs, marginBottom: space.md },
    buttonRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginHorizontal: -space.lg },
    divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    button: { flex: 1, paddingVertical: space.md, alignItems: 'center', justifyContent: 'center' },
    buttonLabel: { ...type.body, color: colors.textPrimary },
    primaryLabel: { color: colors.accent, fontWeight: '700' },
    destructiveLabel: { color: colors.danger, fontWeight: '700' },
  });
}
