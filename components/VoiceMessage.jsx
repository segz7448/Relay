import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { space, type, useTheme } from '../theme';
import { formatDuration } from '../utils/fileTypes';
import UploadRing from './UploadRing';
import ActionSheet from './ActionSheet';

const SPEEDS = [1, 1.5, 2];
const BAR_COUNT = 32;

// The other half of VoiceRecorder: a play button, a waveform that fills
// in as it plays and can be tapped/dragged to scrub, an elapsed/
// remaining time readout, a cycling speed pill, and — for anything not
// captured on this device — the same not-downloaded / downloading /
// failed states VideoMessage uses, via the same UploadRing.
//
// Playback runs only when the persisted message carries a real audio URI.
export default function VoiceMessage({
  attachment,
  isOut,
  message,
  download,
  onStartDownload,
  onCancelDownload,
  onRetryDownload,
  onOpenReply,
  onForward,
  onShare,
  onSave,
  onDelete,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [played, setPlayed] = useState(!isOut && !!attachment.listened);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [waveWidth, setWaveWidth] = useState(0);

  const soundRef = useRef(null);

  const duration = attachment.duration ?? 0;
  const speed = SPEEDS[speedIndex];
  const bars = useMemo(() => attachment.waveform ?? [], [attachment.waveform]);

  const isDownloading = download && download.status === 'downloading';
  const downloadFailed = download && download.status === 'failed';
  const notStarted = download && download.status === 'idle';
  const isDownloaded = !isDownloading && !downloadFailed && !notStarted;

  useEffect(
    () => () => {
      soundRef.current?.unloadAsync().catch(() => {});

    },
    []
  );

  function onPlaybackStatus(status) {
    if (!status.isLoaded) return;
    setPosition(status.positionMillis / 1000);
    if (status.didJustFinish) {
      setPlaying(false);
      setPosition(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  }

  function startUnavailableTicker() {
    setPlaying(false);
  }

  async function play() {
    setPlayed(true);
    if (attachment.uri) {
      try {
        if (!soundRef.current) {
          const { sound } = await Audio.Sound.createAsync(
            { uri: attachment.uri },
            { shouldPlay: true, rate: speed, positionMillis: position * 1000 },
            onPlaybackStatus
          );
          soundRef.current = sound;
        } else {
          await soundRef.current.setRateAsync(speed, true);
          await soundRef.current.playAsync();
        }
        setPlaying(true);
        return;
      } catch {
        setPlaying(false);
        return;
      }
    }
    startUnavailableTicker();
  }

  function pause() {
    setPlaying(false);

    soundRef.current?.pauseAsync().catch(() => {});
  }

  function togglePlay() {
    if (notStarted) return onStartDownload?.(message);
    if (isDownloading || downloadFailed) return;
    if (playing) pause();
    else play();
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    soundRef.current?.setRateAsync(SPEEDS[next], true).catch(() => {});
  }

  function seekToRatio(ratio) {
    if (!isDownloaded || !duration) return;
    const next = Math.max(0, Math.min(duration, duration * ratio));
    setPosition(next);
    soundRef.current?.setPositionAsync(next * 1000).catch(() => {});
  }

  const progressRatio = duration > 0 ? Math.min(1, position / duration) : 0;
  const filledBars = Math.round(progressRatio * bars.length);
  const timeLabel = formatDuration(position > 0 ? Math.max(0, duration - position) : duration);

  const actions = [
    { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: () => onOpenReply?.(message) },
    { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => onForward?.(message) },
    { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => onShare?.(message) },
    { key: 'save', label: 'Save Audio', icon: 'download-outline', onPress: () => onSave?.(message) },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => onDelete?.(message) },
  ];

  return (
    <>
      <Pressable onLongPress={() => setActionsOpen(true)} delayLongPress={220} style={styles.row}>
        <Pressable onPress={togglePlay} hitSlop={6} style={[styles.playBtn, isOut && styles.playBtnOut]}>
          {isDownloading ? (
            <UploadRing size={40} progress={download.progress} status="uploading" onCancel={() => onCancelDownload?.(message)} />
          ) : downloadFailed ? (
            <UploadRing size={40} status="failed" onRetry={() => onRetryDownload?.(message)} />
          ) : notStarted ? (
            <Ionicons name="arrow-down" size={18} color={isOut ? colors.onAccent : '#FFFFFF'} />
          ) : (
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={18}
              color={isOut ? colors.onAccent : '#FFFFFF'}
              style={!playing ? { marginLeft: 2 } : null}
            />
          )}
        </Pressable>

        <View style={styles.body}>
          <Pressable
            style={styles.waveformWrap}
            onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}
            onPress={(e) => waveWidth > 0 && seekToRatio(e.nativeEvent.locationX / waveWidth)}
          >
            {bars.map((v, i) => (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: 3 + v * 17,
                    backgroundColor:
                      i < filledBars ? (isOut ? colors.onAccent : colors.accent) : isOut ? 'rgba(26,16,6,0.3)' : colors.border,
                  },
                ]}
              />
            ))}
          </Pressable>

          <View style={styles.metaRow}>
            {!played ? <View style={[styles.unreadDot, { backgroundColor: isOut ? colors.onAccent : colors.accent }]} /> : null}
            <Text style={[styles.durationText, isOut && styles.textOut]}>{timeLabel}</Text>
            <View style={{ flex: 1 }} />
            {isDownloaded ? (
              <Pressable onPress={cycleSpeed} hitSlop={6} style={[styles.speedPill, isOut && styles.speedPillOut]}>
                <Text style={[styles.speedText, isOut && styles.textOut]}>{speed}×</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>

      <ActionSheet visible={actionsOpen} onClose={() => setActionsOpen(false)} actions={actions} />
    </>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 210, maxWidth: 240, paddingVertical: 2 },
    playBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    playBtnOut: { backgroundColor: 'rgba(26,16,6,0.18)' },
    body: { flex: 1, minWidth: 0 },
    waveformWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 22 },
    bar: { width: 2.5, borderRadius: 1.5 },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
    unreadDot: { width: 6, height: 6, borderRadius: 3 },
    durationText: { ...type.small, color: colors.textMuted, fontWeight: '600' },
    textOut: { color: 'rgba(26,16,6,0.65)' },
    speedPill: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    speedPillOut: { backgroundColor: 'rgba(26,16,6,0.14)' },
    speedText: { ...type.small, fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  });
}
