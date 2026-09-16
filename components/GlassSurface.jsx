// components/GlassSurface.jsx
//
// Shared frosted-glass panel used by cards, sheets, dialogs, pills and
// icon wells across the app. This is the difference between "glassy"
// and "just translucent": earlier, `colors.surface` was a flat rgba
// fill sitting on top of opaque screen backgrounds, so nothing behind
// a card ever actually blurred — it just looked like a dim solid
// panel. GlassSurface wraps children in a real BlurView (same
// technique PremiumBackdrop and GlassTabBar already use for the
// wallpaper and the tab bar), so whatever sits behind a card —
// PremiumBackdrop's drifting glow blobs, content scrolling underneath
// a sheet — genuinely reads through, then layers a soft tint, a
// hairline highlight border, and a top sheen on top so text and icons
// stay legible.
//
// variant:
//  'card'   — settings sections, panels, message bubbles (radius.md)
//  'sheet'  — bottom sheets, action sheets, dialogs (radius.lg)
//  'pill'   — small rounded chips/buttons/reaction bars (radius.xl)
//  'well'   — circular icon wells (fully rounded)

import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { radius, useTheme } from '../theme';

const RADIUS_BY_VARIANT = {
  card: radius.md,
  sheet: radius.lg,
  pill: radius.xl,
  well: 999,
};

export default function GlassSurface({
  children,
  variant = 'card',
  intensity,
  tintOpacity,
  style,
  contentStyle,
  pointerEventsThrough,
  ...rest
}) {
  const { scheme, colors } = useTheme();
  const styles = useMemo(() => makeStyles(scheme, colors, variant), [scheme, colors, variant]);
  const r = RADIUS_BY_VARIANT[variant] ?? radius.lg;
  const defaultIntensity =
    variant === 'well' || variant === 'pill'
      ? (scheme === 'light' ? 46 : 56)
      : (scheme === 'light' ? 34 : 44);

  return (
    <View
      style={[styles.wrap, { borderRadius: r }, style]}
      pointerEvents={pointerEventsThrough ? 'box-none' : undefined}
      {...rest}
    >
      <BlurView
        pointerEvents="none"
        intensity={intensity ?? defaultIntensity}
        tint={scheme === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.tint, tintOpacity != null && { opacity: tintOpacity }]}
      />
      <View pointerEvents="none" style={[styles.sheen]} />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

function makeStyles(scheme, colors, variant) {
  const isLight = scheme === 'light';
  return StyleSheet.create({
    wrap: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.10)',
      shadowColor: '#000',
      shadowOpacity: isLight ? 0.08 : 0.32,
      shadowRadius: variant === 'sheet' ? 24 : 14,
      shadowOffset: { width: 0, height: variant === 'sheet' ? 10 : 6 },
      elevation: variant === 'sheet' ? 10 : 4,
    },
    tint: {
      backgroundColor: isLight
        ? 'rgba(255,255,255,0.38)'
        : 'rgba(22,26,31,0.40)',
    },
    // A faint top-edge highlight — the classic glass-panel "light catching
    // the top rim" cue — kept subtle so it reads as material, not a stripe.
    sheen: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '45%',
      backgroundColor: isLight ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.05)',
    },
    content: {},
  });
}
