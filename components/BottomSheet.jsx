// components/BottomSheet.jsx
//
// Generic drag-to-dismiss bottom sheet for cases that aren't one of the
// existing bespoke sheets (AttachmentSheet, EmojiPickerSheet, etc.) —
// e.g. a filter/sort sheet on the dashboard. Spring open, rubber-band
// past the top, swipe-down (or drag past halfway) to dismiss.

import { useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, type, useTheme } from '../theme';
import { springs } from '../utils/motion';
import { hapticTap } from '../utils/haptics';

export default function BottomSheet({ visible, onClose, title, children, maxHeightRatio = 0.8 }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const y = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);

  function animateIn() {
    y.setValue(400);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(y, { toValue: 0, ...springs.soft }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function animateOut(cb) {
    Animated.parallel([
      Animated.timing(y, { toValue: 400, duration: 180, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(cb);
  }

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
      onPanResponderGrant: () => {
        y.stopAnimation((v) => (dragStart.current = v));
      },
      onPanResponderMove: (_, g) => {
        y.setValue(Math.max(0, dragStart.current + g.dy));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 1.2) {
          hapticTap();
          animateOut(() => onClose?.());
        } else {
          Animated.spring(y, { toValue: 0, ...springs.soft }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onShow={animateIn} onRequestClose={() => animateOut(() => onClose?.())}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => animateOut(() => onClose?.())} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: `${maxHeightRatio * 100}%`, paddingBottom: insets.bottom + space.md, transform: [{ translateY: y }] },
          ]}
        >
          <View {...pan.panHandlers} style={styles.handleWrap}>
            <View style={styles.handle} />
            {title ? <Text style={styles.title}>{title}</Text> : null}
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      borderWidth: 1, borderColor: colors.border,
    },
    handleWrap: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.xs },
    title: { ...type.h2, color: colors.textPrimary, marginTop: space.xs, marginBottom: space.xs },
  });
}
