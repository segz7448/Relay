import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { colors, type, space } from '../theme';

const CONFIG = {
  idle: { color: colors.textMuted, label: 'Ready' },
  working: { color: colors.accent, label: 'Working…' },
  success: { color: colors.online, label: 'Success' },
  error: { color: colors.danger, label: 'Action needed' },
};

// A tiny live status readout, same visual language as StatusPill on the
// bots list — reused here so the auth flow feels like part of the same
// control-room product instead of a bolted-on login page. Reflects real
// async state (idle/working/success/error), not decorative copy.
export default function StatusTicker({ state = 'idle', label }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const c = CONFIG[state] ?? CONFIG.idle;

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, { backgroundColor: c.color, opacity: state === 'idle' ? 1 : pulse }]} />
      <Text style={[styles.label, { color: c.color }]}>{label ?? c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  dot: { width: 5, height: 5, borderRadius: 3 },
  label: { ...type.dataSm },
});
