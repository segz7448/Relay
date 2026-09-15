import { useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, Animated, StyleSheet, Platform } from 'react-native';
import { space, useTheme, FONT_SCALE_STEPS } from '../theme';

const THUMB = 26;
const TRACK_H = 4;

// A Telegram-style "Aa ─●── Aa" slider: small A / big A at either end, a
// draggable thumb between them that snaps to one of FONT_SCALE_STEPS.
// Fully gesture-driven (no external slider dependency), mirroring the
// swipe-to-reply PanResponder pattern already used in MessageBubble.
export default function TextSizeSlider({ value, onChange }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [trackWidth, setTrackWidth] = useState(0);
  const stepCount = FONT_SCALE_STEPS.length;
  const initialIndex = Math.max(0, FONT_SCALE_STEPS.indexOf(value));
  const x = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function indexToX(index, width) {
    if (stepCount <= 1) return 0;
    return (width - THUMB) * (index / (stepCount - 1));
  }

  function xToIndex(px, width) {
    if (stepCount <= 1 || width <= THUMB) return 0;
    const ratio = Math.min(1, Math.max(0, px / (width - THUMB)));
    return Math.round(ratio * (stepCount - 1));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const width = widthRef.current;
        if (!width) return;
        const px = evt.nativeEvent.locationX - THUMB / 2;
        const idx = xToIndex(px, width);
        x.setValue(indexToX(idx, width));
        onChangeRef.current?.(FONT_SCALE_STEPS[idx]);
      },
      onPanResponderMove: (_, gesture) => {
        const width = widthRef.current;
        if (!width) return;
        const px = gesture.moveX - gesture.x0 + indexToX(Math.max(0, FONT_SCALE_STEPS.indexOf(value)), width);
        const clamped = Math.min(width - THUMB, Math.max(0, px));
        x.setValue(clamped);
      },
      onPanResponderRelease: (_, gesture) => {
        const width = widthRef.current;
        if (!width) return;
        const px = gesture.moveX - gesture.x0 + indexToX(Math.max(0, FONT_SCALE_STEPS.indexOf(value)), width);
        const idx = xToIndex(px, width);
        Animated.spring(x, { toValue: indexToX(idx, width), useNativeDriver: false, speed: 24, bounciness: 6 }).start();
        onChangeRef.current?.(FONT_SCALE_STEPS[idx]);
      },
    })
  ).current;

  function handleLayout(e) {
    const width = e.nativeEvent.layout.width;
    widthRef.current = width;
    setTrackWidth(width);
    x.setValue(indexToX(initialIndex, width));
  }

  return (
    <View style={styles.row}>
      <Text style={styles.smallA}>A</Text>
      <View style={styles.trackWrap} onLayout={handleLayout} {...panResponder.panHandlers}>
        <View style={styles.track} />
        <View style={styles.ticksRow} pointerEvents="none">
          {FONT_SCALE_STEPS.map((_, i) => (
            <View key={i} style={styles.tick} />
          ))}
        </View>
        {trackWidth ? (
          <Animated.View style={[styles.thumb, { transform: [{ translateX: x }] }]} />
        ) : null}
      </View>
      <Text style={styles.bigA}>A</Text>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.sm },
    smallA: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    bigA: { fontSize: 20, fontWeight: '600', color: colors.textSecondary },
    trackWrap: { flex: 1, height: THUMB, justifyContent: 'center' },
    track: {
      position: 'absolute',
      left: THUMB / 2,
      right: THUMB / 2,
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      backgroundColor: colors.border,
    },
    ticksRow: {
      position: 'absolute',
      left: THUMB / 2,
      right: THUMB / 2,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    tick: { width: 2, height: 2, borderRadius: 1, backgroundColor: colors.borderBright },
    thumb: {
      position: 'absolute',
      left: 0,
      width: THUMB,
      height: THUMB,
      borderRadius: THUMB / 2,
      backgroundColor: colors.accent,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
        android: { elevation: 3 },
      }),
    },
  });
}
