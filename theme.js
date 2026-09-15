// theme.js — design tokens for the bot manager, in both appearances.
//
// Only `colors` differs between light and dark; type/space/radius are
// the same tokens either way. Screens/components should read colors via
// the `useTheme()` hook below (not the static `colors` export) so they
// re-render when the person switches appearance in Settings.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Dark — the original "control-room" palette.
export const darkColors = {
  bg: '#14181C',
  surface: '#1C2126',
  surfaceRaised: '#242B31',
  border: '#2C333A',
  borderBright: '#3A434B',

  textPrimary: '#E8ECEF',
  textSecondary: '#8B98A3',
  textMuted: '#5B6670',

  accent: '#FF8A3D',       // signal amber — live/active states only
  accentDim: '#8A4E27',
  onAccent: '#1A1006',     // text/icon color placed on top of `accent`

  online: '#4FD1A5',       // muted teal-green
  onlineDim: '#1F3A32',

  danger: '#E5584D',
  dangerDim: '#3A2220',

  warning: '#E5B84D',

  bubbleIn: '#242B31',     // incoming message bubble
  onBubbleIn: '#E8ECEF',
};

// Light — same structure and the same amber/teal/red accents (this is
// still botmanager's control-room identity, just on a light backdrop),
// with a Telegram-style light chat surface: white/near-white bubbles,
// pale gray screen background.
export const lightColors = {
  bg: '#F2F3F5',
  surface: '#FFFFFF',
  surfaceRaised: '#ECEEF1',
  border: '#DFE2E6',
  borderBright: '#CBD0D6',

  textPrimary: '#181C20',
  textSecondary: '#5B6670',
  textMuted: '#8B98A3',

  accent: '#FF8A3D',
  accentDim: '#FFD9B8',
  onAccent: '#1A1006',

  online: '#1E9C74',
  onlineDim: '#DFF3EA',

  danger: '#D1453B',
  dangerDim: '#FBE3E1',

  warning: '#B9860F',

  bubbleIn: '#FFFFFF',     // incoming message bubble — white card on the pale bg
  onBubbleIn: '#181C20',
};

// Kept for any file not yet migrated to useTheme() — always the dark
// palette, matching this app's original (only) appearance.
export const colors = darkColors;

export const type = {
  sans: 'System',
  mono: 'Menlo, Courier',

  display: { fontSize: 28, fontWeight: '600', letterSpacing: -0.3 },
  h1: { fontSize: 20, fontWeight: '600' },
  h2: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '400' },
  small: { fontSize: 12, fontWeight: '400' },
  dataLg: { fontFamily: 'Menlo', fontSize: 20, fontWeight: '600' },
  dataSm: { fontFamily: 'Menlo', fontSize: 12, fontWeight: '400' },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 20, xl: 32 };

export const radius = { sm: 4, md: 8, lg: 14, xl: 22 };

// Assigned per-conversation (hashed from id) for solid-color initial
// avatars — the Telegram-style "no photo" fallback. One set works on
// both backgrounds since these are always painted as solid fills behind
// white initials, not read as text/border color.
export const avatarPalette = [
  '#3D6E8A', // slate blue
  '#3D8A6E', // deep teal
  '#8A5A3D', // clay
  '#6E3D8A', // muted violet
  '#8A3D5A', // rose
  '#5A8A3D', // olive
  '#3D5A8A', // indigo
];

// Low-opacity accent washes — separate per appearance since the same
// alpha value reads very differently on a near-black vs. near-white bg.
export const glowByScheme = {
  dark: {
    accent: 'rgba(255, 138, 61, 0.10)',
    accentSoft: 'rgba(255, 138, 61, 0.06)',
    online: 'rgba(79, 209, 165, 0.08)',
  },
  light: {
    accent: 'rgba(255, 138, 61, 0.12)',
    accentSoft: 'rgba(255, 138, 61, 0.07)',
    online: 'rgba(30, 156, 116, 0.10)',
  },
};

// Back-compat static export (dark) for anything reading `glow` directly.
export const glow = glowByScheme.dark;

// ---------------------------------------------------------------------
// Accent color — a small Telegram-style palette. Each preset carries its
// own "on accent" (text/icon placed on top of it) and dim variants for
// both schemes, since a light accent needs a different dim wash than a
// dark one to stay legible.
// ---------------------------------------------------------------------

export const ACCENT_PRESETS = [
  { id: 'tangerine', label: 'Tangerine', swatch: '#FF8A3D', onAccent: '#1A1006', dimDark: '#8A4E27', dimLight: '#FFD9B8' },
  { id: 'azure', label: 'Azure', swatch: '#3D9BFF', onAccent: '#FFFFFF', dimDark: '#1F4A75', dimLight: '#CFE6FF' },
  { id: 'emerald', label: 'Emerald', swatch: '#34B27B', onAccent: '#FFFFFF', dimDark: '#1B5F42', dimLight: '#C9F0DF' },
  { id: 'amethyst', label: 'Amethyst', swatch: '#8B6FF0', onAccent: '#FFFFFF', dimDark: '#4A3B80', dimLight: '#E1D9FB' },
  { id: 'rose', label: 'Rose', swatch: '#ED6FA3', onAccent: '#FFFFFF', dimDark: '#7A3A54', dimLight: '#FBDCE9' },
  { id: 'sunflower', label: 'Sunflower', swatch: '#E8B93D', onAccent: '#1A1006', dimDark: '#7A631F', dimLight: '#FBE9BF' },
];

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------
// Chat background — solid wallpaper tints behind the message list, one
// value per scheme (a dark-mode wallpaper is a deep tint, its light-mode
// counterpart a pale one). 'default' means "no override" — just use the
// screen's own `colors.bg`.
// ---------------------------------------------------------------------

export const CHAT_BG_PRESETS = [
  { id: 'default', label: 'Classic', dark: null, light: null },
  { id: 'midnight', label: 'Midnight', dark: '#0F1B2E', light: '#E8F0FB' },
  { id: 'forest', label: 'Forest', dark: '#0F241B', light: '#E7F5EC' },
  { id: 'plum', label: 'Plum', dark: '#231326', light: '#F5E9F7' },
  { id: 'sand', label: 'Sand', dark: '#241B0F', light: '#FBF1DF' },
  { id: 'slate', label: 'Slate', dark: '#1A1F26', light: '#EEF1F5' },
  { id: 'rosewood', label: 'Rosewood', dark: '#26141A', light: '#FCE8ED' },
];

// ---------------------------------------------------------------------
// Text size — discrete steps a slider snaps to, same shape as Telegram's
// "Aa ── Aa" control. 1.0 is the app's original type scale.
// ---------------------------------------------------------------------

export const FONT_SCALE_STEPS = [0.85, 0.925, 1.0, 1.075, 1.15, 1.225, 1.3];

export function scaleFont(size, fontScale) {
  return Math.round(size * fontScale * 10) / 10;
}

// ---------------------------------------------------------------------
// Appearance switching: theme mode, accent color, chat background, text
// size, and animations — all persisted on-device.
// ---------------------------------------------------------------------

const MODE_KEY = 'botmanager_theme_mode'; // 'light' | 'dark' | 'system'
const APPEARANCE_KEY = 'botmanager_appearance_prefs'; // { accentId, chatBgId, fontScale, animationsEnabled }

const DEFAULT_APPEARANCE = {
  accentId: 'tangerine',
  chatBgId: 'default',
  fontScale: 1.0,
  animationsEnabled: true,
};

const ThemeContext = createContext({
  mode: 'system',
  scheme: 'dark',
  colors: darkColors,
  glow: glowByScheme.dark,
  setMode: () => {},
  accentId: 'tangerine',
  setAccentId: () => {},
  chatBgId: 'default',
  setChatBgId: () => {},
  chatBackgroundColor: null,
  fontScale: 1.0,
  setFontScale: () => {},
  animationsEnabled: true,
  setAnimationsEnabled: () => {},
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null on some platforms
  const [mode, setModeState] = useState('system');
  const [appearance, setAppearanceState] = useState(DEFAULT_APPEARANCE);

  // Load saved preferences once; defaults hold until then, so there's no
  // theme flash — the app just starts by following the OS / originals.
  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    });
    SecureStore.getItemAsync(APPEARANCE_KEY).then((raw) => {
      if (!raw) return;
      try {
        setAppearanceState({ ...DEFAULT_APPEARANCE, ...JSON.parse(raw) });
      } catch {
        // corrupt value — keep defaults
      }
    });
  }, []);

  function setMode(next) {
    setModeState(next);
    SecureStore.setItemAsync(MODE_KEY, next).catch(() => {});
  }

  function patchAppearance(patch) {
    setAppearanceState((prev) => {
      const next = { ...prev, ...patch };
      SecureStore.setItemAsync(APPEARANCE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  const setAccentId = (id) => patchAppearance({ accentId: id });
  const setChatBgId = (id) => patchAppearance({ chatBgId: id });
  const setFontScale = (v) => patchAppearance({ fontScale: v });
  const setAnimationsEnabled = (v) => patchAppearance({ animationsEnabled: v });

  const scheme = mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;

  const value = useMemo(() => {
    const base = scheme === 'light' ? lightColors : darkColors;
    const accentPreset = ACCENT_PRESETS.find((a) => a.id === appearance.accentId) ?? ACCENT_PRESETS[0];
    const colors = {
      ...base,
      accent: accentPreset.swatch,
      onAccent: accentPreset.onAccent,
      accentDim: scheme === 'light' ? accentPreset.dimLight : accentPreset.dimDark,
    };
    const baseGlow = glowByScheme[scheme];
    const glowValue = {
      ...baseGlow,
      accent: hexToRgba(accentPreset.swatch, scheme === 'light' ? 0.12 : 0.1),
      accentSoft: hexToRgba(accentPreset.swatch, scheme === 'light' ? 0.07 : 0.06),
    };
    const bgPreset = CHAT_BG_PRESETS.find((p) => p.id === appearance.chatBgId) ?? CHAT_BG_PRESETS[0];
    const chatBackgroundColor = scheme === 'light' ? bgPreset.light : bgPreset.dark;

    return {
      mode,
      scheme,
      colors,
      glow: glowValue,
      setMode,
      accentId: accentPreset.id,
      setAccentId,
      chatBgId: bgPreset.id,
      setChatBgId,
      chatBackgroundColor,
      fontScale: appearance.fontScale,
      setFontScale,
      animationsEnabled: appearance.animationsEnabled,
      setAnimationsEnabled,
    };
  }, [mode, scheme, appearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// The hook screens/components should use for anything appearance-aware:
// const { colors, scheme, fontScale, animationsEnabled } = useTheme();
export function useTheme() {
  return useContext(ThemeContext);
}
