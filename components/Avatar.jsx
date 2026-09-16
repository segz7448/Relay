import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { avatarPalette } from "../theme";
export function hashColor(seed) {
  let h = 0;
  for (const x of seed || "?") h = (h * 31 + x.charCodeAt(0)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}
export function initials(name) {
  const p = (name || "").trim().replace(/^@/, "").split(/\s+/);
  return p.length > 1
    ? (p[0][0] + p[1][0]).toUpperCase()
    : (p[0]?.[0] || "?").toUpperCase();
}
export default function Avatar({ uri, name, size = 44, style }) {
  const s = useMemo(() => styles(size), [size]),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  if (uri && !failed)
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={[s.img, style]}
      />
    );
  return (
    <View
      style={[s.img, s.fallback, { backgroundColor: hashColor(name) }, style]}
    >
      <Text style={[s.initials, { fontSize: size * 0.38 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}
const styles = (size) =>
  StyleSheet.create({
    img: { width: size, height: size, borderRadius: size / 2 },
    fallback: { alignItems: "center", justifyContent: "center" },
    initials: { color: "#F2F4F6", fontWeight: "700" },
  });
