import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { type, space, radius, useTheme } from '../theme';

// iOS/Telegram-style grouped section: an uppercase muted label above a
// rounded card, with hairline separators drawn between children (not
// around them) — the same shape ActionSheet uses for its action groups.
export default function SettingsSection({ title, footer, children }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.card}>
        {items.map((child, i) => (
          <View key={i} style={i > 0 ? styles.separator : null}>
            {child}
          </View>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    wrap: { marginBottom: space.lg },
    title: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginBottom: space.sm, marginLeft: 2,
    },
    card: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, overflow: 'hidden',
    },
    separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    footer: { ...type.small, color: colors.textMuted, marginTop: space.sm, marginLeft: 2, lineHeight: 16 },
  });
}
