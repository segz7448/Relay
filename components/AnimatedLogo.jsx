import { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// The app mark: pops in on mount, then breathes a soft ring outward on
// loop — the same "system is live" idea as AuthBackground, scaled down
// to the one element every screen in the flow shares.
export default function AnimatedLogo({ size = 64, icon = 'hardware-chip' }) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 12 }),
      Animated.timing(opacity, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={[styles.wrap, { width: size * 1.8, height: size * 1.8 }]}>
      <Animated.View
        style={[
          styles.ring,
          {
            width: size * 1.5,
            height: size * 1.5,
            borderRadius: size,
            transform: [{ scale: ringScale }],
            opacity: ringOpacity,
          },
        ]}
      />
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.28 }]}>
          <Ionicons name={icon} size={size * 0.5} color="#1A1006" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  ring: { position: 'absolute', backgroundColor: colors.accent },
  mark: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
