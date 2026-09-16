// utils/haptics.js
//
// Thin, crash-proof wrapper around expo-haptics — same dynamic-import
// pattern the attachment pickers in app/conversation/[id].jsx use, so a
// missing/unlinked native module degrades to a silent no-op instead of
// taking down the reaction UI.

async function withHaptics(fn) {
  try {
    const Haptics = await import('expo-haptics');
    await fn(Haptics);
  } catch {
    // Not installed on this platform/build — reactions still work, just silently.
  }
}

export function hapticTap() {
  withHaptics((Haptics) => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function hapticBurst() {
  withHaptics((Haptics) => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function hapticSwitch() {
  withHaptics((Haptics) => Haptics.selectionAsync());
}
