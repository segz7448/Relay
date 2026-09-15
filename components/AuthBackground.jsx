import { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { glow } from '../theme';

// Slow, low-opacity drifting orbs behind the auth screens — the one
// continuous "live" motion in the flow. Deliberately subtle: this is a
// control-room tool, not a marketing page, so the ambient motion reads as
// "the system is alive" rather than as decoration.
function Orb({ size, color, style, duration, distance }) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, distance] });

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ translateY }] },
        style,
      ]}
    />
  );
}

export default function AuthBackground() {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Orb size={260} color={glow.accent} style={styles.topRight} duration={5400} distance={20} />
      <Orb size={230} color={glow.online} style={styles.bottomLeft} duration={6800} distance={-24} />
      <Orb size={150} color={glow.accentSoft} style={styles.midLeft} duration={7400} distance={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  topRight: { position: 'absolute', top: -90, right: -70 },
  bottomLeft: { position: 'absolute', bottom: -70, left: -60 },
  midLeft: { position: 'absolute', top: '42%', left: -50 },
});
