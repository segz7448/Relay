import { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { avatarPalette } from '../theme';

// Same hash-to-color + initials scheme ConversationRow/BotRow/etc already
// use for "no photo" fallbacks — pulled out here so Settings' profile
// header and Edit Profile can share it instead of redefining it again.
export function hashColor(seed) {
  let h = 0;
  const s = seed || '?';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

export function initials(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.replace(/^@/, '').split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Avatar({ uri, name, size = 44, style }) {
  const styles = useMemo(() => getStyles(size), [size]);
  if (uri) {
    return <Image source={{ uri }} style={[styles.img, style]} />;
  }
  return (
    <View style={[styles.img, styles.fallback, { backgroundColor: hashColor(name) }, style]}>
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

function getStyles(size) {
  return StyleSheet.create({
    img: { width: size, height: size, borderRadius: size / 2 },
    fallback: { alignItems: 'center', justifyContent: 'center' },
    initials: { color: '#F2F4F6', fontWeight: '700' },
  });
}
