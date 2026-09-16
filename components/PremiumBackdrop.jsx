import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';

export default function PremiumBackdrop({ children }) {
  const { scheme, colors, animationsEnabled } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!animationsEnabled || reduceMotion) { drift.stopAnimation(); drift.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, [animationsEnabled, reduceMotion, drift]);
  const styles = useMemo(() => makeStyles(scheme, colors), [scheme, colors]);
  const a = { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-20, 28] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-8, 32] }) }] };
  const b = { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [24, -24] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [24, -18] }) }] };
  return <View style={styles.root}>
    <Animated.View pointerEvents="none" style={[styles.glow, styles.glowA, a]} />
    <Animated.View pointerEvents="none" style={[styles.glow, styles.glowB, b]} />
    <BlurView pointerEvents="none" intensity={scheme === 'light' ? 24 : 34} tint={scheme === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
    <View style={styles.content}>{children}</View>
  </View>;
}
const makeStyles=(scheme,colors)=>StyleSheet.create({
  root:{flex:1,backgroundColor:scheme==='light'?'#E9EDF3':'#090D12'}, content:{flex:1},
  glow:{position:'absolute',width:310,height:310,borderRadius:155,opacity:scheme==='light'?0.2:0.14},
  glowA:{top:-90,right:-100,backgroundColor:colors.accent}, glowB:{bottom:-120,left:-100,backgroundColor:colors.online},
});
