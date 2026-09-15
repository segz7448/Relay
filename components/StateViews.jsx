// components/StateViews.jsx
//
// The "no static dead screens" set: what a list/detail screen shows
// instead of a blank View when there's nothing to show, something
// failed, or the device has no connection.

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTheme } from '../theme';
import { useEnter, usePressScale } from '../utils/motion';
import { useNetworkStatus } from '../utils/useNetworkStatus';

// --- Empty state -----------------------------------------------------

export function EmptyState({ icon = 'file-tray-outline', title, message, actionLabel, onAction }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { style, play } = useEnter({ distance: 10 });
  useEffect(play, []);

  return (
    <Animated.View style={[styles.wrap, style]}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel ? (
        <RetryButton label={actionLabel} onPress={onAction} colors={colors} styles={styles} />
      ) : null}
    </Animated.View>
  );
}

// --- Error / retry state ----------------------------------------------

export function ErrorState({ title = 'Something went wrong', message, onRetry, retrying }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { style, play } = useEnter({ distance: 10 });
  useEffect(play, []);

  return (
    <Animated.View style={[styles.wrap, style]}>
      <View style={[styles.iconCircle, { backgroundColor: colors.dangerDim }]}>
        <Ionicons name="cloud-offline-outline" size={26} color={colors.danger} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {onRetry ? (
        <RetryButton label={retrying ? 'Retrying…' : 'Try again'} onPress={onRetry} disabled={retrying} colors={colors} styles={styles} />
      ) : null}
    </Animated.View>
  );
}

function RetryButton({ label, onPress, disabled, colors, styles }) {
  const { style, onPressIn, onPressOut } = usePressScale(0.94);
  return (
    <Animated.View style={style}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled} style={styles.retryBtn}>
        <Text style={styles.retryLabel}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// --- Offline banner ----------------------------------------------------

// Mount once near the root; slides down whenever the device loses
// connectivity and slides back up the moment it's restored.
export function OfflineBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { isOffline } = useNetworkStatus();
  const y = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    Animated.timing(y, {
      toValue: isOffline ? 0 : -40,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [isOffline]);

  return (
    <Animated.View pointerEvents="none" style={[styles.offlineWrap, { transform: [{ translateY: y }] }]}>
      <View style={styles.offlineBar}>
        <Ionicons name="cloud-offline-outline" size={13} color={colors.onAccent} />
        <Text style={styles.offlineText}>No connection — showing saved data</Text>
      </View>
    </Animated.View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, paddingVertical: space.xl, flexGrow: 1 },
    iconCircle: {
      width: 60, height: 60, borderRadius: 30,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceRaised, marginBottom: space.md,
    },
    title: { ...type.h2, color: colors.textPrimary, textAlign: 'center' },
    message: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xs },
    retryBtn: {
      marginTop: space.lg, paddingHorizontal: space.lg, paddingVertical: space.sm,
      borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    retryLabel: { ...type.body, color: colors.accent, fontWeight: '700' },

    offlineWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 998, alignItems: 'center' },
    offlineBar: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.textMuted, paddingHorizontal: space.md, paddingVertical: 4,
      borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md,
    },
    offlineText: { ...type.small, fontSize: 11, color: colors.bg, fontWeight: '600' },
  });
}
