// components/SwipeableRow.jsx
//
// iOS-Mail-style swipe actions for list rows (conversations, calls,
// notifications) without adding react-native-gesture-handler — built on
// PanResponder + Animated, consistent with the rest of the app.
//
// <SwipeableRow
//   rightActions={[{ key: 'delete', label: 'Delete', icon: 'trash', color: colors.danger, onPress: () => remove(item) }]}
//   leftActions={[{ key: 'pin', label: 'Pin', icon: 'pin', color: colors.accent, onPress: () => pin(item) }]}
// >
//   <ConversationRow ... />
// </SwipeableRow>

import { useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, type } from '../theme';
import { hapticSwitch, hapticTap } from '../utils/haptics';

const ACTION_WIDTH = 76;

export default function SwipeableRow({ children, leftActions = [], rightActions = [], disabled }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(null); // 'left' | 'right' | null
  const startX = useRef(0);
  const crossedThreshold = useRef(false);

  const maxLeft = leftActions.length * ACTION_WIDTH;
  const maxRight = rightActions.length * ACTION_WIDTH;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !disabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        translateX.stopAnimation((v) => (startX.current = v));
        crossedThreshold.current = false;
      },
      onPanResponderMove: (_, g) => {
        let next = startX.current + g.dx;
        next = Math.max(-maxRight, Math.min(maxLeft, next));
        translateX.setValue(next);
        const justCrossed = Math.abs(next) > ACTION_WIDTH * 0.6;
        if (justCrossed !== crossedThreshold.current) {
          crossedThreshold.current = justCrossed;
          hapticSwitch();
        }
      },
      onPanResponderRelease: (_, g) => {
        const current = startX.current + g.dx;
        let target = 0;
        let nextOpen = null;
        if (current > ACTION_WIDTH * 0.5 && maxLeft > 0) {
          target = maxLeft;
          nextOpen = 'left';
        } else if (current < -ACTION_WIDTH * 0.5 && maxRight > 0) {
          target = -maxRight;
          nextOpen = 'right';
        }
        setOpen(nextOpen);
        Animated.timing(translateX, { toValue: target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      },
    })
  ).current;

  function close() {
    setOpen(null);
    Animated.timing(translateX, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }

  function runAction(action) {
    hapticTap();
    close();
    action.onPress?.();
  }

  return (
    <View style={styles.wrap}>
      {leftActions.length ? (
        <View style={[styles.actionRow, { left: 0 }]}>
          {leftActions.map((a) => (
            <ActionCell key={a.key} action={a} onPress={() => runAction(a)} />
          ))}
        </View>
      ) : null}
      {rightActions.length ? (
        <View style={[styles.actionRow, { right: 0 }]}>
          {rightActions.map((a) => (
            <ActionCell key={a.key} action={a} onPress={() => runAction(a)} />
          ))}
        </View>
      ) : null}
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX }] }}>
        <Pressable onPress={open ? close : undefined}>{children}</Pressable>
      </Animated.View>
    </View>
  );
}

function ActionCell({ action, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, { width: ACTION_WIDTH, backgroundColor: action.color }]}>
      <Ionicons name={action.icon} size={20} color="#fff" />
      <Text style={styles.actionLabel}>{action.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  actionRow: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' },
  action: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  actionLabel: { ...type.small, fontSize: 10.5, color: '#fff', fontWeight: '700' },
});
