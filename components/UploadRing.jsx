import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// Overlay painted on top of a file/photo/video/audio tile while it's
// still going up: a ring that fills clockwise from 12 o'clock (the same
// sweep Telegram uses on its upload/download rings), the percentage in
// the center, and — since this is the one moment sending a file needs a
// person's attention — a cancel tap target live on top of it. On
// failure the ring is swapped for a retry glyph instead of redrawing
// the whole tile.
export default function UploadRing({ size = 44, progress = 0, status = 'uploading', onCancel, onRetry, dark }) {
  const { colors } = useTheme();
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashoffset = circumference * (1 - clamped);
  const tint = dark ? '#FFFFFF' : colors.accent;
  const track = dark ? 'rgba(255,255,255,0.28)' : colors.border;

  if (status === 'failed') {
    return (
      <Pressable onPress={onRetry} style={[styles.overlay, { width: size, height: size, borderRadius: size / 2 }]} hitSlop={6}>
        <View style={[styles.scrim, { borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.45)' }]} />
        <Ionicons name="refresh" size={size * 0.42} color="#FFFFFF" />
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onCancel} style={[styles.overlay, { width: size, height: size }]} hitSlop={6}>
      <View style={[styles.scrim, { borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.45)' }]} />
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tint}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
        />
      </Svg>
      <Ionicons name="close" size={size * 0.4} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center' },
  scrim: { ...StyleSheet.absoluteFillObject },
});
