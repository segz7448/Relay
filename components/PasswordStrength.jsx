import { useMemo, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { type, space, radius, useTheme } from '../theme';

function scoreOf(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const levelsFor = (colors) => [
  { label: 'Too short', color: colors.textMuted },
  { label: 'Weak', color: colors.danger },
  { label: 'Fair', color: colors.warning },
  { label: 'Good', color: colors.online },
  { label: 'Strong', color: colors.online },
];

export default function PasswordStrength({ password }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const score = scoreOf(password);
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, { toValue: score, duration: 260, useNativeDriver: false }).start();
  }, [score]);

  const barWidth = width.interpolate({ inputRange: [0, 4], outputRange: ['4%', '100%'] });
  const level = levelsFor(colors)[password ? score : 0];

  if (!password) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: barWidth, backgroundColor: level.color }]} />
      </View>
      <Text style={[styles.label, { color: level.color }]}>{level.label}</Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: -space.sm, marginBottom: space.lg },
  track: { flex: 1, height: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.sm },
  label: { ...type.small, fontWeight: '600', width: 66 },
});
