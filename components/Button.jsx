import { useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import GlassSurface from './GlassSurface';

function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
  return { scale, onPressIn, onPressOut };
}

// Three-dot loading indicator, staggered — used inside buttons instead of
// a stock spinner so a "working" state feels like part of this app rather
// than a default RN component dropped in.
// Static on purpose: the dots' geometry is theme-independent, and Dots
// previously crashed every loading button by referencing the themed
// `styles` object that only exists inside the button components.
const dotStyles = StyleSheet.create({
  dotsRow: { flexDirection: 'row', gap: 5, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

function Dots({ color }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay((2 - i) * 120),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={dotStyles.dotsRow}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={[dotStyles.dot, { backgroundColor: color, opacity: v }]} />
      ))}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, loading, icon, accessibilityLabel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = usePressScale();
  const inactive = disabled || loading;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
        style={[styles.primary, inactive && styles.disabled]}
      >
        {loading ? (
          <Dots color={colors.onAccent} />
        ) : (
          <View style={styles.contentRow}>
            {icon ? <Ionicons name={icon} size={17} color={colors.onAccent} style={{ marginRight: space.sm }} /> : null}
            <Text style={styles.primaryLabel}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function SecondaryButton({ label, onPress, disabled, loading, icon, accessibilityLabel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = usePressScale();
  const inactive = disabled || loading;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
      >
        <GlassSurface variant="card" style={[styles.secondary, inactive && { opacity: 0.5 }]} contentStyle={styles.secondaryContent}>
          {loading ? (
            <Dots color={colors.textPrimary} />
          ) : (
            <View style={styles.contentRow}>
              {icon ? <Ionicons name={icon} size={17} color={colors.textPrimary} style={{ marginRight: space.sm }} /> : null}
              <Text style={styles.secondaryLabel}>{label}</Text>
            </View>
          )}
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

// Plain-text tappable link — "Forgot password?", "Resend code", etc.
export function TextLink({ label, onPress, disabled, muted, align = 'center', accessibilityLabel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.timing(opacity, { toValue: 0.55, duration: 80, useNativeDriver: true }).start();
  const onPressOut = () => Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }}>
      <Animated.Text
        style={[
          styles.link,
          { textAlign: align, opacity, color: disabled ? colors.textMuted : muted ? colors.textSecondary : colors.accent },
        ]}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

// Small circular icon button — used for the back chevron on auth sub-screens.
export function IconGhostButton({ icon, onPress, size = 38, label = 'Back' }) {
  const { colors } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressScale(0.9);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <GlassSurface
          variant="well"
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={icon} size={19} color={colors.textPrimary} />
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    contentRow: { flexDirection: 'row', alignItems: 'center' },
    primary: {
      backgroundColor: colors.accent,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: 'center',
    },
    primaryLabel: { ...type.h2, color: colors.onAccent },
    disabled: { backgroundColor: colors.accentDim },
    secondary: {},
    secondaryContent: {
      paddingVertical: space.md,
      alignItems: 'center',
    },
    secondaryLabel: { ...type.h2, color: colors.textPrimary },
    link: { ...type.small, fontWeight: '600' },
    dotsRow: { flexDirection: 'row', gap: 5, paddingVertical: 2 },
    dot: { width: 6, height: 6, borderRadius: 3 },
  });
}
