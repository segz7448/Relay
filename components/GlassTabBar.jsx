import { useMemo, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RelayTabIcon from "./RelayTabIcon";
import { type, space, radius, useTheme } from "../theme";

// route.name -> icon pair + label. Outline for inactive, filled for the
// active tab — a small premium touch instead of a static icon set.
// Only real, routable tabs belong here — a config entry without a route
// would render nothing, and a route without an entry renders nothing.
const TAB_CONFIG = {
  index: { label: "Messages", symbol: "messages" },
  calls: { label: "Calls", symbol: "calls" },
  relay: { label: "Server Relay", symbol: "relay" },
  settings: { label: "Settings", symbol: "settings" },
};

function TabChip({ focused, config, badge, onPress, colors, styles }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  const onPressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.item}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${config.label} tab`}
      accessibilityState={{ selected: focused }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <View style={[styles.chip, focused && styles.chipActive]}>
          <RelayTabIcon
            name={config.symbol}
            size={21}
            color={focused ? colors.accent : colors.textSecondary}
          />
          {badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
      <Text style={[styles.label, focused && styles.labelActive]}>
        {config.label}
      </Text>
    </Pressable>
  );
}

// Custom bottom tab bar: a floating glass pill with rounded-square icon
// chips, standing in for React Navigation's default flat bar.
export default function GlassTabBar({ state, navigation, unreadCount = 0 }) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => getStyles(colors, scheme), [colors, scheme]);

  return (
    <View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, space.md) }]}
      pointerEvents="box-none"
    >
      <View style={styles.barClip}>
        <BlurView
          intensity={45}
          tint={scheme === "light" ? "light" : "dark"}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.tint} />
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const config = TAB_CONFIG[route.name];
            if (!config) return null;

            function onPress() {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented)
                navigation.navigate(route.name);
            }

            return (
              <TabChip
                key={route.key}
                focused={focused}
                config={config}
                // Unread push notifications badge on the tab that holds
                // the in-app inbox (Settings -> Notifications).
                badge={route.name === "settings" ? unreadCount : 0}
                onPress={onPress}
                colors={colors}
                styles={styles}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function getStyles(colors, scheme) {
  const isLight = scheme === "light";
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 16,
      right: 16,
      alignItems: "stretch",
    },
    barClip: {
      borderRadius: 32,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: isLight ? "rgba(20,24,28,0.08)" : "rgba(255,255,255,0.08)",
    },
    tint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isLight
        ? "rgba(255,255,255,0.55)"
        : "rgba(20,24,28,0.45)",
    },
    row: {
      flexDirection: "row",
      paddingVertical: 7,
      paddingHorizontal: 4,
    },
    item: { flex: 1, alignItems: "center", gap: 4 },
    chip: {
      width: 54,
      height: 42,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    chipActive: {
      backgroundColor: isLight
        ? "rgba(215,216,220,0.70)"
        : "rgba(255,255,255,0.10)",
    },
    label: { ...type.small, fontSize: 10.5, color: colors.textMuted },
    labelActive: { color: colors.accent, fontWeight: "600" },
    badge: {
      position: "absolute",
      top: -4,
      right: -4,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      backgroundColor: colors.danger,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.bg,
    },
    badgeText: { fontSize: 9, fontWeight: "700", color: "#fff" },
  });
}
