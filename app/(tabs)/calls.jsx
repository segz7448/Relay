import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../api";
import { useCall } from "../../callStore";
import { type, space, radius, useTheme } from "../../theme";
import { EmptyState } from "../../components/StateViews";
const label = (c) =>
  c.state === "ended"
    ? c.endReason === "rejected"
      ? "Declined"
      : c.answeredAt
        ? "Completed"
        : "Missed"
    : c.state;
export default function Calls() {
  const { colors } = useTheme(),
    s = useMemo(() => styles(colors), [colors]),
    router = useRouter(),
    { activeCall } = useCall(),
    [items, setItems] = useState([]),
    [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => setItems(await api.listCalls()), []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };
  return (
    <View style={s.screen}>
      {activeCall ? (
        <Pressable
          style={s.live}
          onPress={() => router.push(`/call/${activeCall.id}`)}
        >
          <Ionicons name="call" size={18} color="#fff" />
          <Text style={s.liveText}>
            {activeCall.direction === "incoming"
              ? "Incoming call"
              : "Call in progress"}{" "}
            · Tap to open
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}
        ListEmptyComponent={
          <EmptyState
            icon="call-outline"
            title="No calls yet"
            message="Voice calls with Relay users will appear here."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() =>
              item.state !== "ended" && router.push(`/call/${item.id}`)
            }
          >
            <View style={s.icon}>
              <Ionicons
                name={item.direction === "incoming" ? "call-outline" : "call"}
                size={20}
                color={colors.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>
                {item.direction === "incoming"
                  ? "Incoming voice call"
                  : "Outgoing voice call"}
              </Text>
              <Text style={s.meta}>
                {label(item)} · {new Date(item.startedAt).toLocaleString()}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
const styles = (c) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    live: {
      margin: space.md,
      backgroundColor: c.online,
      borderRadius: radius.md,
      padding: space.md,
      flexDirection: "row",
      gap: space.sm,
      alignItems: "center",
    },
    liveText: { ...type.body, color: "#fff", fontWeight: "700" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      padding: space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { ...type.body, color: c.textPrimary, fontWeight: "600" },
    meta: { ...type.small, color: c.textMuted, marginTop: 3 },
  });
