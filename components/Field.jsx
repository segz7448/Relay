import { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Animated, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';

// Same component the rest of the app already uses (create-bot, bot/edit,
// the bots search field) — extended with an optional leading icon, a
// reveal toggle for secure fields, an animated focus border, and an
// error state. Every new prop is optional, so existing call sites that
// only pass label/value/onChangeText/placeholder/mono/helper are unaffected.
export default function Field({
  label,
  value,
  onChangeText,
  placeholder,
  mono,
  secure,
  helper,
  error,
  icon,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  editable = true,
  onFocus,
  onBlur,
}) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors, scheme), [colors, scheme]);

  const [revealed, setRevealed] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;

  function handleFocus(e) {
    Animated.timing(focusAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    onFocus?.(e);
  }
  function handleBlur(e) {
    Animated.timing(focusAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    onBlur?.(e);
  }

  const borderColor = error
    ? colors.danger
    : focusAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.accent] });

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Animated.View style={[styles.inputRow, { borderColor }]}>
        <BlurView
          pointerEvents="none"
          intensity={scheme === 'light' ? 26 : 34}
          tint={scheme === 'light' ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.tint} />
        {icon ? <Ionicons name={icon} size={17} color={colors.textMuted} style={styles.icon} /> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && !revealed}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          keyboardType={keyboardType}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[styles.input, mono && { fontFamily: 'Menlo' }]}
        />
        {secure ? (
          <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={10}>
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors, scheme) => StyleSheet.create({
  wrap: { marginBottom: space.lg },
  label: { ...type.small, color: colors.textSecondary, marginBottom: space.xs, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    overflow: 'hidden',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: scheme === 'light' ? 'rgba(255,255,255,0.34)' : 'rgba(22,26,31,0.36)',
  },
  icon: { marginRight: space.sm },
  input: { flex: 1, color: colors.textPrimary, fontSize: 14, paddingVertical: space.md },
  helper: { ...type.small, color: colors.textMuted, marginTop: space.xs },
  error: { ...type.small, color: colors.danger, marginTop: space.xs, fontWeight: '500' },
});
