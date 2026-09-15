import { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type,
  space,
  radius,
  useTheme,
  ACCENT_PRESETS,
  CHAT_BG_PRESETS,
  scaleFont,
} from '../theme';
import SettingsSection from '../components/SettingsSection';
import ToggleRow from '../components/ToggleRow';
import TextSizeSlider from '../components/TextSizeSlider';
import { hapticTap } from '../utils/haptics';
import { usePressScale } from '../utils/motion';

const THEME_OPTIONS = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function AppearanceSettingsScreen() {
  const {
    colors,
    scheme,
    mode,
    setMode,
    accentId,
    setAccentId,
    chatBgId,
    setChatBgId,
    fontScale,
    setFontScale,
    animationsEnabled,
    setAnimationsEnabled,
  } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      {/* ── Theme ─────────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Theme</Text>
      <View style={styles.segmented}>
        {THEME_OPTIONS.map((opt) => (
          <ThemeSegment
            key={opt.key}
            opt={opt}
            active={mode === opt.key}
            colors={colors}
            styles={styles}
            onPress={() => { hapticTap(); setMode(opt.key); }}
          />
        ))}
      </View>
      <Text style={styles.helper}>"System" follows this device's own light/dark setting automatically.</Text>

      {/* ── Accent color ──────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Accent Color</Text>
      <View style={styles.card}>
        <View style={styles.swatchRow}>
          {ACCENT_PRESETS.map((preset) => (
            <AccentSwatch
              key={preset.id}
              preset={preset}
              active={accentId === preset.id}
              styles={styles}
              onPress={() => { hapticTap(); setAccentId(preset.id); }}
            />
          ))}
        </View>
      </View>
      <Text style={styles.helper}>Colors links, buttons, and your own message bubbles throughout the app.</Text>

      {/* ── Chat background ───────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Chat Background</Text>
      <View style={styles.card}>
        <ChatPreview colors={colors} accentId={accentId} />
        <View style={styles.bgGrid}>
          {CHAT_BG_PRESETS.map((preset) => {
            const swatchColor = preset.id === 'default' ? colors.bg : scheme === 'light' ? preset.light : preset.dark;
            return (
              <BgSwatch
                key={preset.id}
                preset={preset}
                swatchColor={swatchColor}
                active={chatBgId === preset.id}
                colors={colors}
                styles={styles}
                onPress={() => { hapticTap(); setChatBgId(preset.id); }}
              />
            );
          })}
        </View>
      </View>

      {/* ── Message appearance (text size) ───────────────────────── */}
      <Text style={styles.sectionLabel}>Text Size</Text>
      <View style={styles.card}>
        <Text style={[styles.previewText, { fontSize: scaleFont(15, fontScale) }]}>
          The quick brown fox jumps over the lazy dog.
        </Text>
        <TextSizeSlider value={fontScale} onChange={setFontScale} />
      </View>
      <Text style={styles.helper}>Changes the size of message text in your chats.</Text>

      {/* ── Animations ───────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Animations</Text>
      <SettingsSection footer="Turns off message reaction bursts and bubble press effects. Everything still works — just without the motion.">
        <ToggleRow
          label="Animations"
          value={animationsEnabled}
          onValueChange={setAnimationsEnabled}
        />
      </SettingsSection>
    </ScrollView>
  );
}

function ThemeSegment({ opt, active, colors, styles, onPress }) {
  const { style, onPressIn, onPressOut } = usePressScale(0.94);
  return (
    <Animated.View style={[{ flex: 1 }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.segment, active && styles.segmentActive]}
      >
        <Ionicons name={opt.icon} size={16} color={active ? colors.onAccent : colors.textSecondary} />
        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{opt.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function AccentSwatch({ preset, active, styles, onPress }) {
  const { style, onPressIn, onPressOut } = usePressScale(0.85);
  return (
    <Animated.View style={style}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={styles.swatchTouch} hitSlop={4}>
        <View style={[styles.swatch, { backgroundColor: preset.swatch }, active && styles.swatchRing]}>
          {active ? <Ionicons name="checkmark" size={16} color={preset.onAccent} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function BgSwatch({ preset, swatchColor, active, colors, styles, onPress }) {
  const { style, onPressIn, onPressOut } = usePressScale(0.92);
  return (
    <Animated.View style={style}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} style={styles.bgItem}>
        <View
          style={[
            styles.bgSwatch,
            { backgroundColor: swatchColor, borderColor: preset.id === 'default' ? colors.border : 'transparent' },
            active && styles.swatchRing,
          ]}
        >
          {active ? <Ionicons name="checkmark" size={18} color={colors.textPrimary} /> : null}
        </View>
        <Text style={styles.bgLabel} numberOfLines={1}>{preset.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// A tiny two-bubble mockup so the chat-background choice previews live,
// exactly like Telegram's own wallpaper picker.
function ChatPreview({ colors, accentId }) {
  const preset = ACCENT_PRESETS.find((a) => a.id === accentId) ?? ACCENT_PRESETS[0];
  return (
    <View style={[previewStyles.wrap, { backgroundColor: colors.bg }]}>
      <View style={[previewStyles.bubble, previewStyles.bubbleIn, { backgroundColor: colors.bubbleIn, borderColor: colors.border, borderWidth: colors.bubbleIn === '#FFFFFF' ? 1 : 0 }]}>
        <Text style={{ color: colors.onBubbleIn, fontSize: 13 }}>Hey — got a minute?</Text>
      </View>
      <View style={[previewStyles.bubble, previewStyles.bubbleOut, { backgroundColor: preset.swatch }]}>
        <Text style={{ color: preset.onAccent, fontSize: 13 }}>Sure, what's up?</Text>
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  wrap: { borderRadius: radius.md, padding: space.md, marginBottom: space.md, gap: 6 },
  bubble: { maxWidth: '72%', paddingVertical: 7, paddingHorizontal: space.md, borderRadius: radius.lg },
  bubbleIn: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleOut: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
});

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      ...type.small,
      color: colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: space.lg,
      marginBottom: space.sm,
    },
    helper: { ...type.small, color: colors.textMuted, marginTop: space.sm, marginBottom: space.md, lineHeight: 16 },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
    },
    previewText: { ...type.body, color: colors.textPrimary, marginBottom: 4 },

    segmented: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: 4,
      gap: 4,
      marginBottom: space.xs,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
    },
    segmentActive: { backgroundColor: colors.accent },
    segmentLabel: { ...type.small, color: colors.textSecondary, fontWeight: '600' },
    segmentLabelActive: { color: colors.onAccent },

    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    swatchTouch: { padding: 2 },
    swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    swatchRing: { borderWidth: 2.5, borderColor: colors.textPrimary },

    bgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xs },
    bgItem: { alignItems: 'center', width: 64 },
    bgSwatch: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    bgLabel: { ...type.small, fontSize: 11, color: colors.textSecondary },
  });
}
