import { useMemo, useRef } from 'react';
import { Pressable, Animated, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// Small round glass button for the header — the Telegram-style compose/
// edit affordance in the top right. Deliberately small (32px) so it reads
// as a secondary action next to the screen title, not a second CTA.
export default function HeaderIconButton({ icon = 'create-outline', onPress, size = 32 }) {
  const { scheme } = useTheme();
  const styles = useMemo(() => getStyles(scheme), [scheme]);
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], marginRight: 14 }}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={10}>
        <BlurView
          intensity={40}
          tint="light"
          style={[styles.button, { width: size, height: size, borderRadius: size / 2 }]}
        >
          <Ionicons name={icon} size={size * 0.46} color="#1C2126" />
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}

function getStyles(scheme) {
  const isLight = scheme === 'light';
  return StyleSheet.create({
    button: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: isLight ? 'rgba(20,24,28,0.06)' : 'rgba(255,255,255,0.55)',
      borderWidth: 1,
      borderColor: isLight ? 'rgba(20,24,28,0.14)' : 'rgba(255,255,255,0.7)',
    },
  });
}
