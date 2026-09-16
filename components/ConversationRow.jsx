import { useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  View,
  Text,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type, space, avatarPalette, useTheme } from "../theme";
import Avatar from "./Avatar";

const ACTION_W = 76;
const LEFT_MAX = ACTION_W * 2; // revealed by swiping right: read, pin
const RIGHT_MAX = ACTION_W * 2; // revealed by swiping left: mute, delete
const AVATAR = 54;

function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timeLabel(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < min) return "now";
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function ActionButton({ icon, label, color, onPress, styles }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionBtn, { backgroundColor: color }]}
    >
      <Ionicons name={icon} size={19} color="#14181C" />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function ConversationRow({
  convo,
  onPress,
  onLongPress,
  onPin,
  onMarkRead,
  onMute,
  onDelete,
  selectable,
  selected,
  onToggleSelect,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !selectable && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        const next = Math.max(
          -RIGHT_MAX,
          Math.min(LEFT_MAX, offset.current + g.dx),
        );
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const proposed = offset.current + g.dx;
        let target = 0;
        if (proposed > ACTION_W) target = LEFT_MAX;
        else if (proposed < -ACTION_W) target = -RIGHT_MAX;
        offset.current = target;
        Animated.spring(translateX, {
          toValue: target,
          useNativeDriver: true,
          speed: 24,
          bounciness: 4,
        }).start();
      },
    }),
  ).current;

  function closeSwipe() {
    offset.current = 0;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start();
  }

  function fire(handler) {
    closeSwipe();
    handler?.(convo);
  }

  const subtitle = convo.typing
    ? "typing…"
    : convo.attachment?.type === "voice"
      ? `Voice message, ${convo.attachment.duration}`
      : convo.attachment?.type === "file"
        ? convo.attachment.name
        : convo.lastMessage || "No messages yet";

  const subtitleIcon =
    !convo.typing && convo.attachment?.type === "voice"
      ? "mic"
      : !convo.typing && convo.attachment?.type === "file"
        ? "attach"
        : null;

  const showOnlineDot =
    convo.online && (convo.kind === "direct" || convo.kind === "bot");
  const badgeColor = convo.muted ? colors.textMuted : colors.accent;

  return (
    <View style={styles.wrap}>
      <View style={[styles.actionsRow, { left: 0 }]}>
        <ActionButton
          icon="checkmark-done"
          label={convo.unread > 0 ? "Read" : "Unread"}
          color={colors.online}
          onPress={() => fire(onMarkRead)}
          styles={styles}
        />
        <ActionButton
          icon="pin"
          label={convo.pinned ? "Unpin" : "Pin"}
          color={colors.accent}
          onPress={() => fire(onPin)}
          styles={styles}
        />
      </View>
      <View style={[styles.actionsRow, { right: 0 }]}>
        <ActionButton
          icon="volume-mute"
          label={convo.muted ? "Unmute" : "Mute"}
          color={colors.textSecondary}
          onPress={() => fire(onMute)}
          styles={styles}
        />
        <ActionButton
          icon="trash"
          label="Delete"
          color={colors.danger}
          onPress={() => fire(onDelete)}
          styles={styles}
        />
      </View>

      <Animated.View
        style={{ transform: [{ translateX }], backgroundColor: colors.bg }}
        {...(selectable ? {} : panResponder.panHandlers)}
      >
        <Pressable
          onPress={() =>
            selectable ? onToggleSelect?.(convo) : onPress?.(convo)
          }
          onLongPress={() => onLongPress?.(convo)}
          style={({ pressed }) => [
            styles.row,
            pressed && { backgroundColor: colors.surfaceRaised },
          ]}
        >
          {selectable ? (
            <View style={styles.checkboxSlot}>
              <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                {selected ? (
                  <Ionicons name="checkmark" size={14} color="#14181C" />
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.avatarWrap}>
              <Avatar uri={convo.photoUrl} name={convo.name} size={AVATAR} />
              {showOnlineDot ? <View style={styles.onlineDot} /> : null}
            </View>
          )}

          <View style={styles.main}>
            <View style={styles.topLine}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {convo.name}
                </Text>
                {convo.muted ? (
                  <Ionicons
                    name="volume-mute"
                    size={13}
                    color={colors.textMuted}
                    style={{ marginLeft: 5 }}
                  />
                ) : null}
              </View>
              <Text style={styles.time}>{timeLabel(convo.lastMessageAt)}</Text>
            </View>

            <View style={styles.bottomLine}>
              {subtitleIcon ? (
                <Ionicons
                  name={subtitleIcon}
                  size={13}
                  color={convo.unread > 0 ? colors.textSecondary : colors.textMuted}
                  style={styles.subtitleIcon}
                />
              ) : null}
              <Text
                style={[
                  styles.subtitle,
                  convo.typing && styles.typing,
                  convo.unread > 0 && !convo.typing && styles.subtitleUnread,
                ]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
              <View style={styles.trailing}>
                {convo.pinned ? (
                  <Ionicons
                    name="pin"
                    size={13}
                    color={colors.textMuted}
                    style={{ marginRight: convo.unread > 0 ? 6 : 0 }}
                  />
                ) : null}
                {convo.unread > 0 ? (
                  <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                    <Text style={styles.badgeText}>
                      {convo.unread > 99 ? "99+" : convo.unread}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </Pressable>
        <View style={styles.separator} />
      </Animated.View>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    wrap: { position: "relative", backgroundColor: colors.bg },
    actionsRow: {
      position: "absolute",
      top: 0,
      bottom: 0,
      flexDirection: "row",
    },
    actionBtn: {
      width: ACTION_W,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    actionLabel: { ...type.small, color: "#14181C", fontWeight: "700" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: space.sm + 2,
      paddingHorizontal: space.lg,
      gap: space.md,
    },
    avatarWrap: { position: "relative" },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: "#F2F4F6", fontSize: 19, fontWeight: "600" },
    onlineDot: {
      position: "absolute",
      right: 1,
      bottom: 1,
      width: 13,
      height: 13,
      borderRadius: 7,
      backgroundColor: colors.online,
      borderWidth: 2,
      borderColor: colors.bg,
    },
    checkboxSlot: {
      width: AVATAR,
      alignItems: "center",
      justifyContent: "center",
    },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    main: { flex: 1, justifyContent: "center" },
    topLine: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    nameRow: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
    name: {
      ...type.h2,
      fontSize: 16,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    time: { ...type.small, color: colors.textMuted, marginLeft: space.sm },
    bottomLine: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 3,
    },
    subtitleIcon: { marginRight: 4 },
    subtitle: {
      ...type.body,
      color: colors.textMuted,
      flex: 1,
      marginRight: space.sm,
    },
    subtitleUnread: { color: colors.textSecondary, fontWeight: "600" },
    typing: { color: colors.accent, fontWeight: "600" },
    trailing: { flexDirection: "row", alignItems: "center" },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      ...type.small,
      color: "#14181C",
      fontWeight: "700",
      fontSize: 11,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: space.lg + AVATAR + space.md,
    },
  });
}
