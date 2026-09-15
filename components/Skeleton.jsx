// components/Skeleton.jsx
//
// Shimmer placeholders shown while a list/detail screen's first fetch is
// in flight, so nothing renders as a static blank screen. Building
// blocks (`SkeletonBox`, `SkeletonCircle`) plus ready-made row shapes for
// the two most common layouts in this app (chat-list row, generic
// card row).

import { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { radius, space, useTheme } from '../theme';
import { useShimmer } from '../utils/motion';

export function SkeletonBox({ width, height, radius: r = 6, style }) {
  const { colors } = useTheme();
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[{ width, height, borderRadius: r, backgroundColor: colors.borderBright, opacity }, style]}
    />
  );
}

export function SkeletonCircle({ size = 44, style }) {
  return <SkeletonBox width={size} height={size} radius={size / 2} style={style} />;
}

// Mimics ConversationRow / CallRow: avatar + two lines + trailing meta.
export function SkeletonListRow() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <SkeletonCircle size={48} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBox width="55%" height={14} />
        <SkeletonBox width="80%" height={12} />
      </View>
      <SkeletonBox width={30} height={10} />
    </View>
  );
}

export function SkeletonList({ count = 6, row: Row = SkeletonListRow }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <Row key={i} />
      ))}
    </View>
  );
}

// A card-shaped skeleton for dashboard/bot tiles.
export function SkeletonCard({ height = 84 }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  return (
    <View style={[styles.card, { height }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <SkeletonCircle size={36} />
        <SkeletonBox width="45%" height={14} />
      </View>
      <SkeletonBox width="70%" height={11} style={{ marginTop: space.sm }} />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.md,
      paddingHorizontal: space.lg, paddingVertical: space.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.md,
      marginHorizontal: space.lg,
      marginBottom: space.sm,
    },
  });
}
