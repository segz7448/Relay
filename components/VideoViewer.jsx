import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Animated,
  PanResponder,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { type, space, radius, useTheme } from '../theme';
import ActionSheet from './ActionSheet';

const { width: SCREEN_W } = Dimensions.get('window');
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.9;
const AUTO_HIDE_MS = 3000;
const TRACK_WIDTH = SCREEN_W - space.md * 2 - 88; // leaves room for the two time labels

function formatMillis(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Telegram-for-iOS media viewer, video edition: same black stage,
// drag-to-dismiss, and overflow/action-bar chrome as ImageViewer, with
// the video's own controls layered in — a scrub bar you can drag, a
// center play/pause that fades with the rest of the chrome, a mute
// toggle with an inline volume slider, and a fullscreen button that
// rotates into landscape the way Telegram's does.
export default function VideoViewer({
  visible,
  uri,
  posterUri,
  senderName,
  onClose,
  onReply,
  onForward,
  onShare,
  onDownload,
  onSave,
  onDelete,
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles2 = useMemo(() => getStyles(colors), [colors]);
  const videoRef = useRef(null);
  const backdrop = useRef(new Animated.Value(1)).current;
  const chrome = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef(null);

  const [status, setStatus] = useState({ positionMillis: 0, durationMillis: 0, isPlaying: false, isBuffering: true });
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubX, setScrubX] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(chrome, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    }, AUTO_HIDE_MS);
  }, [chrome]);

  const showChrome = useCallback(() => {
    Animated.timing(chrome, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    scheduleHide();
  }, [chrome, scheduleHide]);

  useEffect(() => {
    if (visible) {
      chrome.setValue(1);
      scheduleHide();
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      setFullscreen(false);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [visible, chrome, scheduleHide]);

  function toggleChromeTap() {
    // Animated.Value has no public getter — stopAnimation hands back the
    // current value via its callback, which is the only way to read it.
    chrome.stopAnimation((v) => {
      if (v > 0.5) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        Animated.timing(chrome, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      } else {
        showChrome();
      }
    });
  }

  async function togglePlay() {
    if (!videoRef.current) return;
    if (status.isPlaying) await videoRef.current.pauseAsync();
    else await videoRef.current.playAsync();
    showChrome();
  }

  async function toggleFullscreen() {
    const next = !fullscreen;
    setFullscreen(next);
    try {
      await ScreenOrientation.lockAsync(
        next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP
      );
    } catch {
      // Orientation locking isn't available on this platform (e.g. web) — the
      // modal still fills the screen, it just won't rotate.
    }
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    await videoRef.current?.setIsMutedAsync(next);
  }

  const volumeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const pct = Math.max(0, Math.min(1, x / 72));
        setVolume(pct);
        videoRef.current?.setVolumeAsync(pct);
        if (pct === 0 && !muted) toggleMute();
        if (pct > 0 && muted) toggleMute();
      },
    })
  ).current;

  const scrubResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setScrubbing(true);
        setScrubX(Math.max(0, Math.min(TRACK_WIDTH, evt.nativeEvent.locationX)));
      },
      onPanResponderMove: (evt) => {
        setScrubX(Math.max(0, Math.min(TRACK_WIDTH, evt.nativeEvent.locationX)));
      },
      onPanResponderRelease: async () => {
        const pct = TRACK_WIDTH ? scrubX / TRACK_WIDTH : 0;
        const target = pct * (status.durationMillis || 0);
        await videoRef.current?.setPositionAsync(target);
        setScrubbing(false);
        scheduleHide();
      },
    })
  ).current;

  // Vertical drag on the video itself, below the scrub bar's territory,
  // reads as swipe-to-dismiss — same threshold/backdrop-fade feel as
  // the photo viewer.
  const dismissResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (evt, g) => {
        if (g.dy > 0) backdrop.setValue(1 - Math.min(1, g.dy / 300) * 0.85);
      },
      onPanResponderRelease: (evt, g) => {
        const shouldDismiss = g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY;
        if (shouldDismiss) { onClose?.(); return; }
        Animated.spring(backdrop, { toValue: 1, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!uri) return null;

  const livePct = scrubbing
    ? (TRACK_WIDTH ? scrubX / TRACK_WIDTH : 0)
    : status.durationMillis
      ? status.positionMillis / status.durationMillis
      : 0;
  const liveMillis = scrubbing ? livePct * (status.durationMillis || 0) : status.positionMillis;

  const actions = [
    { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: onReply },
    { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: onForward },
    { key: 'share', label: 'Share', icon: 'share-outline', onPress: onShare },
    { key: 'save', label: 'Save Video', icon: 'download-outline', onPress: onSave },
    { key: 'download', label: 'Download', icon: 'cloud-download-outline', onPress: onDownload },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: onDelete },
  ];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Animated.View style={[styles.root, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={toggleChromeTap} {...dismissResponder.panHandlers}>
          <Video
            ref={videoRef}
            source={{ uri }}
            posterSource={posterUri ? { uri: posterUri } : undefined}
            usePoster={!!posterUri}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            volume={volume}
            isMuted={muted}
            onPlaybackStatusUpdate={(s) => {
              if (!s.isLoaded) return;
              setStatus({
                positionMillis: s.positionMillis ?? 0,
                durationMillis: s.durationMillis ?? 0,
                isPlaying: s.isPlaying,
                isBuffering: s.isBuffering,
              });
            }}
          />
        </Pressable>

        {status.isBuffering && !scrubbing ? (
          <Animated.View style={[styles.bufferWrap, { transform: [{ rotate: spinDeg }] }]} pointerEvents="none">
            <Ionicons name="sync" size={28} color="#FFFFFF" />
          </Animated.View>
        ) : null}

        {!status.isPlaying ? (
          <Pressable style={styles.centerPlay} onPress={togglePlay} hitSlop={16}>
            <Ionicons name="play" size={34} color="#FFFFFF" style={{ marginLeft: 4 }} />
          </Pressable>
        ) : null}

        <Animated.View style={[styles2.topBar, { paddingTop: insets.top + 6, opacity: chrome }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={10} style={styles2.topBtn}>
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles2.topTitle}>
            {senderName ? <Text style={styles2.topName} numberOfLines={1}>{senderName}</Text> : null}
          </View>
          <Pressable onPress={() => setActionsOpen(true)} hitSlop={10} style={styles2.topBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles2.bottomChrome, { paddingBottom: insets.bottom + space.sm, opacity: chrome }]} pointerEvents="box-none">
          <View style={styles2.scrubRow}>
            <Text style={styles2.timeLabel}>{formatMillis(liveMillis)}</Text>
            <View style={styles2.track} {...scrubResponder.panHandlers}>
              <View style={styles2.trackBg} />
              <View style={[styles2.trackFill, { width: `${Math.min(1, Math.max(0, livePct)) * 100}%` }]} />
              <View style={[styles2.thumb, { left: Math.min(1, Math.max(0, livePct)) * TRACK_WIDTH - 7 }]} />
            </View>
            <Text style={styles2.timeLabel}>{formatMillis(status.durationMillis)}</Text>
          </View>

          <View style={styles2.controlsRow}>
            <Pressable onPress={togglePlay} hitSlop={8} style={styles2.iconBtn}>
              <Ionicons name={status.isPlaying ? 'pause' : 'play'} size={22} color="#FFFFFF" />
            </Pressable>

            <Pressable
              onPress={() => setVolumeOpen((v) => !v)}
              hitSlop={8}
              style={styles2.iconBtn}
            >
              <Ionicons name={muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'} size={20} color="#FFFFFF" />
            </Pressable>
            {volumeOpen ? (
              <View style={styles2.volumeSlider} {...volumeResponder.panHandlers}>
                <View style={styles2.volumeTrackBg} />
                <View style={[styles2.volumeTrackFill, { width: `${(muted ? 0 : volume) * 100}%` }]} />
              </View>
            ) : null}

            <View style={{ flex: 1 }} />

            <Pressable onPress={toggleFullscreen} hitSlop={8} style={styles2.iconBtn}>
              <Ionicons name={fullscreen ? 'contract' : 'expand'} size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles2.actionRow}>
            <Pressable onPress={onReply} style={styles2.bottomBtn} hitSlop={8}>
              <Ionicons name="arrow-undo-outline" size={20} color="#FFFFFF" />
              <Text style={styles2.bottomLabel}>Reply</Text>
            </Pressable>
            <Pressable onPress={onForward} style={styles2.bottomBtn} hitSlop={8}>
              <Ionicons name="arrow-redo-outline" size={20} color="#FFFFFF" />
              <Text style={styles2.bottomLabel}>Forward</Text>
            </Pressable>
            <Pressable onPress={onShare} style={styles2.bottomBtn} hitSlop={8}>
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
              <Text style={styles2.bottomLabel}>Share</Text>
            </Pressable>
            <Pressable onPress={onDelete} style={styles2.bottomBtn} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles2.bottomLabel, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>

      <ActionSheet visible={actionsOpen} onClose={() => setActionsOpen(false)} actions={actions} />
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    topBar: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: space.md, paddingBottom: space.sm,
    },
    topBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    topTitle: { flex: 1, alignItems: 'center' },
    topName: { ...type.body, color: '#FFFFFF', fontWeight: '700' },
    bottomChrome: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
    scrubRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    timeLabel: { ...type.small, color: '#FFFFFF', width: 38, textAlign: 'center' },
    track: { width: TRACK_WIDTH, height: 24, justifyContent: 'center' },
    trackBg: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
    trackFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
    thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
    controlsRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm, height: 32 },
    iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    volumeSlider: { width: 72, height: 24, justifyContent: 'center', marginLeft: 2 },
    volumeTrackBg: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
    volumeTrackFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
    actionRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space.md },
    bottomBtn: { alignItems: 'center', gap: 3, paddingHorizontal: space.md },
    bottomLabel: { ...type.small, color: '#FFFFFF' },
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  bufferWrap: { position: 'absolute', top: '50%', left: '50%', marginLeft: -14, marginTop: -14 },
  centerPlay: {
    position: 'absolute', top: '50%', left: '50%', width: 64, height: 64,
    marginLeft: -32, marginTop: -32, borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
});
