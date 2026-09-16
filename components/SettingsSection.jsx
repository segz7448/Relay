import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { type, space, useTheme } from '../theme';
import GlassSurface from './GlassSurface';

// iOS/Telegram-style grouped section: an uppercase muted label above a
// frosted-glass card, with hairline separators drawn between children
// (not around them) — the same shape ActionSheet uses for its action
// groups. The card is a real GlassSurface now (BlurView + tint + rim
// highlight), not a flat tinted rectangle.
export default function SettingsSection({ title, footer, children }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <GlassSurface variant="card" contentStyle={styles.cardContent}>
        {items.map((child, i) => (
          <View key={i} style={i > 0 ? styles.separator : null}>
            {child}
          </View>
        ))}
      </GlassSurface>
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
    cardContent: { paddingHorizontal: space.md },
    separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    footer: { ...type.small, color: colors.textMuted, marginTop: space.sm, marginLeft: 2, lineHeight: 16 },
  });
}
