import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, PanResponder, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { space, radius, type, useTheme } from '../theme';
import { formatDuration } from '../utils/fileTypes';

const CANCEL_DISTANCE = -72; // px dragged left before the hold is discarded
const LOCK_DISTANCE = -64;   // px dragged up before it becomes hands-free
const MAX_BARS = 40;         // live waveform keeps only its most recent samples

// Sits in the Composer's trailing slot. Collapsed it's just the mic
// button; the moment a finger lands on it, this component takes over
// the whole composer row and reproduces Telegram's three ways a hold
// can end: release in place (send), drag left past the threshold
// (cancel), or drag up past the threshold (lock into a hands-free bar
// with its own pause/delete/send controls).
//
// Recording uses expo-av with metering, so both the audio and waveform come from the device microphone.
export default function VoiceRecorder({ onFinish, onActiveChange, disabled }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [phase, setPhase] = useState('idle'); // idle | held | locked
  const [elapsed, setElapsed] = useState(0);
  const [waveform, setWaveform] = useState([]);
  const [paused, setPaused] = useState(false);

  const phaseRef = useRef('idle');
  const pausedRef = useRef(false);
  const recordingRef = useRef(null);
  const elapsedRef = useRef(0);
  const waveformRef = useRef([]);
  const clockTimer = useRef(null);
  const meterTimer = useRef(null);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lockProgress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => () => cleanupTimers(), []);

  function cleanupTimers() {
    clearInterval(clockTimer.current);
    clearInterval(meterTimer.current);
  }

  function setPhaseBoth(next) {
    phaseRef.current = next;
    setPhase(next);
    onActiveChange?.(next !== 'idle');
  }

  async function begin() {
    if (disabled || phaseRef.current !== 'idle') return;
    elapsedRef.current = 0;
    waveformRef.current = [];
    pausedRef.current = false;
    setElapsed(0);
    setWaveform([]);
    setPaused(false);
    dragX.setValue(0);
    dragY.setValue(0);
    lockProgress.setValue(0);
    setPhaseBoth('held');

    recordingRef.current = await startRealRecording();

    clockTimer.current = setInterval(() => {
      if (pausedRef.current) return;
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);

    meterTimer.current = setInterval(async () => {
      if (pausedRef.current) return;
      const sample = await nextSample(recordingRef.current, waveformRef.current);
      waveformRef.current = [...waveformRef.current, sample].slice(-MAX_BARS);
      setWaveform(waveformRef.current);
    }, 120);
  }

  function lock() {
    if (phaseRef.current !== 'held') return;
    setPhaseBoth('locked');
    Animated.spring(lockProgress, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  }

  async function cancel() {
    cleanupTimers();
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {
        // already stopped, or was never really recording — nothing to clean up
      }
      recordingRef.current = null;
    }
    setPhaseBoth('idle');
  }

  function togglePause() {
    if (phaseRef.current !== 'locked') return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (recordingRef.current) {
      const call = next ? recordingRef.current.pauseAsync : recordingRef.current.startAsync;
      call?.call(recordingRef.current).catch(() => {});
    }
  }

  async function finish() {
    cleanupTimers();
    let uri = null;
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
        uri = recordingRef.current.getURI();
      } catch {
        uri = null;
      }
    }
    if (!uri) {
      recordingRef.current = null;
      setPhaseBoth('idle');
      return;
    }
    const duration = Math.max(1, elapsedRef.current);
    const attachment = {
      kind: 'voice',
      name: 'Voice message',
      ext: 'm4a',
      mime: 'audio/m4a',
      uri,
      duration,
      size: Math.round(duration * 6000), // rough estimate for a compressed voice note
      waveform: waveformRef.current,
    };
    recordingRef.current = null;
    setPhaseBoth('idle');
    onFinish?.(attachment);
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: () => begin(),
      onPanResponderMove: (_, g) => {
        if (phaseRef.current !== 'held') return;
        const dx = Math.min(0, g.dx);
        const dy = Math.min(0, g.dy);
        dragX.setValue(Math.max(CANCEL_DISTANCE, dx));
        dragY.setValue(Math.max(LOCK_DISTANCE, dy));
        lockProgress.setValue(Math.min(1, dy / LOCK_DISTANCE));
        if (dx < CANCEL_DISTANCE) cancel();
        else if (dy < LOCK_DISTANCE) lock();
      },
      onPanResponderRelease: () => {
        if (phaseRef.current === 'held') finish();
      },
      onPanResponderTerminate: () => {
        if (phaseRef.current === 'held') cancel();
      },
    })
  ).current;

  const hintOpacity = dragX.interpolate({ inputRange: [CANCEL_DISTANCE, 0], outputRange: [0, 1] });

  if (phase === 'idle') {
    return (
      <View {...pan.panHandlers}>
        <MicCircle colors={colors} styles={styles} />
      </View>
    );
  }

  if (phase === 'held') {
    return (
      <View style={styles.activeRow}>
        <Meter colors={colors} styles={styles} elapsed={elapsed} waveform={waveform} pulse={pulse} />

        <Animated.Text style={[styles.cancelHint, { opacity: hintOpacity, transform: [{ translateX: dragX }] }]} numberOfLines={1}>
          ‹ Slide to cancel
        </Animated.Text>

        <View style={styles.micWrap}>
          <Animated.View
            style={[
              styles.lockRail,
              { opacity: hintOpacity, transform: [{ translateY: dragY }, { scale: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] },
            ]}
          >
            <Ionicons name="chevron-up" size={13} color={colors.textMuted} />
            <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
          </Animated.View>
          <View {...pan.panHandlers}>
            <MicCircle colors={colors} styles={styles} active />
          </View>
        </View>
      </View>
    );
  }

  // locked
  return (
    <View style={styles.activeRow}>
      <Pressable onPress={cancel} hitSlop={8} style={styles.sideBtn}>
        <Ionicons name="trash-outline" size={20} color={colors.danger} />
      </Pressable>

      <Meter colors={colors} styles={styles} elapsed={elapsed} waveform={waveform} pulse={pulse} dimmed={paused} />

      <Pressable onPress={togglePause} hitSlop={8} style={styles.sideBtn}>
        <Ionicons name={paused ? 'play' : 'pause'} size={18} color={colors.textSecondary} />
      </Pressable>

      <Pressable onPress={finish} style={styles.sendCircle}>
        <Ionicons name="arrow-up" size={17} color={colors.onAccent} />
      </Pressable>
    </View>
  );
}

function MicCircle({ colors, styles, active }) {
  return (
    <View style={[styles.micCircle, active && styles.micCircleActive]}>
      <Ionicons name="mic" size={17} color={active ? '#FFFFFF' : colors.textSecondary} />
    </View>
  );
}

function Meter({ colors, styles, elapsed, waveform, pulse, dimmed }) {
  return (
    <View style={styles.meter}>
      <Animated.View style={[styles.recDot, { opacity: dimmed ? 0.4 : pulse, backgroundColor: colors.danger }]} />
      <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
      <View style={styles.waveform}>
        {waveform.map((v, i) => (
          <View key={i} style={[styles.waveBar, { height: 3 + v * 16, backgroundColor: colors.accent, opacity: dimmed ? 0.4 : 1 }]} />
        ))}
      </View>
    </View>
  );
}

// --- recording backends -------------------------------------------------

async function startRealRecording() {
  try {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return null;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync({
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });
    await recording.startAsync();
    return recording;
  } catch {
    return null;
  }
}

async function nextSample(recording) {
  if (!recording) return 0;
  try {
    const status = await recording.getStatusAsync();
    if (status.isRecording && typeof status.metering === 'number') return Math.max(0.05, Math.min(1, (status.metering + 60) / 60));
  } catch {}
  return 0;
}

function getStyles(colors) {
  return StyleSheet.create({
    micCircle: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    micCircleActive: { backgroundColor: colors.danger },

    activeRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },

    meter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    recDot: { width: 8, height: 8, borderRadius: 4 },
    timer: { ...type.dataSm, color: colors.textPrimary, minWidth: 34 },
    waveform: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 20, overflow: 'hidden' },
    waveBar: { width: 2.5, borderRadius: 1.5 },

    cancelHint: {
      position: 'absolute',
      left: 0,
      right: 56,
      textAlign: 'center',
      ...type.small,
      color: colors.textMuted,
    },

    micWrap: { alignItems: 'center', justifyContent: 'center' },
    lockRail: {
      position: 'absolute',
      bottom: '100%',
      marginBottom: 8,
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.lg,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },

    sideBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },
    sendCircle: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accent,
    },
  });
}
