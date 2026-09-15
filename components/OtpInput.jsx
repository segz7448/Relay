import { useEffect, useRef, useState } from 'react';
import { View, TextInput, Animated, StyleSheet } from 'react-native';
import { colors, type, radius, space } from '../theme';

// Six-box verification code entry. `value`/`onChange` are lifted to the
// parent screen; `error`/`success` drive the shake and green-pulse states.
export default function OtpInput({ length = 6, value, onChange, error, success, autoFocus = true }) {
  const inputs = useRef([]);
  const shake = useRef(new Animated.Value(0)).current;
  const pops = useRef(Array.from({ length }, () => new Animated.Value(1))).current;
  const [focusedIndex, setFocusedIndex] = useState(autoFocus ? 0 : -1);

  useEffect(() => {
    if (!error) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [error]);

  function setDigit(i, raw) {
    const d = raw.replace(/[^0-9]/g, '').slice(-1);
    const chars = value.split('');
    chars[i] = d;
    onChange(chars.join('').slice(0, length));
    if (d) {
      Animated.sequence([
        Animated.timing(pops[i], { toValue: 1.18, duration: 70, useNativeDriver: true }),
        Animated.spring(pops[i], { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 10 }),
      ]).start();
      if (i < length - 1) inputs.current[i + 1]?.focus();
    }
  }

  function handleKeyPress(i, e) {
    if (e.nativeEvent.key === 'Backspace' && !value[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });

  return (
    <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
      {Array.from({ length }).map((_, i) => {
        const filled = !!value[i];
        const focused = focusedIndex === i;
        return (
          <Animated.View
            key={i}
            style={[
              styles.box,
              filled && styles.boxFilled,
              focused && !error && !success && styles.boxFocused,
              error && styles.boxError,
              success && styles.boxSuccess,
              { transform: [{ scale: pops[i] }] },
            ]}
          >
            <TextInput
              ref={(r) => (inputs.current[i] = r)}
              value={value[i] || ''}
              onChangeText={(t) => setDigit(i, t)}
              onKeyPress={(e) => handleKeyPress(i, e)}
              onFocus={() => setFocusedIndex(i)}
              onBlur={() => setFocusedIndex(-1)}
              keyboardType="number-pad"
              maxLength={1}
              autoFocus={autoFocus && i === 0}
              style={styles.digit}
              selectionColor={colors.accent}
            />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.md },
  box: {
    width: 46,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.borderBright, backgroundColor: colors.surfaceRaised },
  boxFocused: { borderColor: colors.accent },
  boxError: { borderColor: colors.danger, backgroundColor: colors.dangerDim },
  boxSuccess: { borderColor: colors.online, backgroundColor: colors.onlineDim },
  digit: { ...type.dataLg, color: colors.textPrimary, textAlign: 'center', width: '100%', height: '100%' },
});
