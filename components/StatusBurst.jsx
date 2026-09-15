// components/StatusBurst.jsx
//
// A brief centered checkmark/X burst for moments that deserve more than
// a toast — verifying a code, finishing onboarding, completing a
// destructive action. Imperative: const burst = useStatusBurst();
// burst.success('Verified'); / burst.failure('Incorrect code');
// Auto-dismisses; non-blocking (pointerEvents none on the backdrop).

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTheme } from '../theme';
import { hapticBurst } from '../utils/haptics';

const BurstContext = createContext(null);

export function StatusBurstProvider({ children }) {
  const [item, setItem] = useState(null);
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const play = useCallback((kind, message) => {
    hapticBurst();
    clearTimeout(timer.current);
    setItem({ kind, message });
    scale.setValue(0.5);
    opacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 26, bounciness: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]),
      Animated.delay(900),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setItem(null));
  }, []);

  const api = useMemo(
    () => ({
      success: (message) => play('success', message),
      failure: (message) => play('failure', message),
    }),
    [play]
  );

  return (
    <BurstContext.Provider value={api}>
      {children}
      {item ? <BurstOverlay item={item} scale={scale} opacity={opacity} /> : null}
    </BurstContext.Provider>
  );
}

export function useStatusBurst() {
  const ctx = useContext(BurstContext);
  if (!ctx) return { success: () => {}, failure: () => {} };
  return ctx;
}

function BurstOverlay({ item, scale, opacity }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const isSuccess = item.kind === 'success';
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
        <View style={[styles.iconCircle, { backgroundColor: isSuccess ? colors.onlineDim : colors.dangerDim }]}>
          <Ionicons name={isSuccess ? 'checkmark' : 'close'} size={30} color={isSuccess ? colors.online : colors.danger} />
        </View>
        {item.message ? <Text style={styles.label}>{item.message}</Text> : null}
      </Animated.View>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    card: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: space.lg,
      paddingHorizontal: space.xl,
      alignItems: 'center',
      gap: space.sm,
      minWidth: 140,
    },
    iconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    label: { ...type.small, color: colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  });
}
