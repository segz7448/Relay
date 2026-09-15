import { useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, space, type, useTheme } from '../theme';
import { formatDuration, formatBytes } from '../utils/fileTypes';
import UploadRing from './UploadRing';
import ActionSheet from './ActionSheet';
import VideoViewer from './VideoViewer';

const MIN_ASPECT = 0.66;
const MAX_ASPECT = 1.4;

// Same edge-to-edge treatment as ImageMessage, plus the two extra states
// a video message can be in that a photo can't: not-yet-downloaded (an
// incoming video Telegram hasn't fetched locally yet — shown as a
// tap-to-download glyph with the file size) and downloading (the same
// ring UploadRing already draws for outgoing sends, just pointed the
// other way). Once a local URI exists it behaves just like a photo:
// thumbnail + play button, tap opens the full-screen player.
export default function VideoMessage({
  attachment,
  isOut,
  hasCaption,
  renderMeta,
  cornerRadius = radius.lg,
  message,
  download, // { status: 'idle' | 'downloading' | 'done' | 'failed', progress }
  onStartDownload,
  onCancelDownload,
  onRetryDownload,
  onOpenReply,
  onForward,
  onShare,
  onDownload,
  onSave,
  onDelete,
}) {
  const { colors } = useTheme();
  const [boxWidth, setBoxWidth] = useState(0);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const shimmer = useRef(new Animated.Value(0.35)).current;

  useMemo(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 0.75, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmer]);

  const onLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - boxWidth) > 1) setBoxWidth(w);
  };

  const rawAspect = attachment.height && attachment.width ? attachment.height / attachment.width : 0.85;
  const aspect = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, rawAspect));
  const height = boxWidth ? boxWidth * aspect : undefined;

  const cornerStyle = {
    borderRadius: cornerRadius,
    borderBottomLeftRadius: hasCaption ? 4 : (isOut ? cornerRadius : 4),
    borderBottomRightRadius: hasCaption ? 4 : (isOut ? 4 : cornerRadius),
  };

  const isDownloaded = !download || download.status === 'done';
  const isDownloading = download && download.status === 'downloading';
  const downloadFailed = download && download.status === 'failed';
  const notStarted = download && download.status === 'idle';

  function onPress() {
    if (notStarted) return onStartDownload?.(message);
    if (isDownloading || downloadFailed) return; // handled by the ring itself
    setViewerOpen(true);
  }

  const actions = [
    { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: () => onOpenReply?.(message) },
    { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => onForward?.(message) },
    { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => onShare?.(message) },
    { key: 'save', label: 'Save Video', icon: 'download-outline', onPress: () => onSave?.(message) },
    { key: 'download', label: 'Download', icon: 'cloud-download-outline', onPress: () => onDownload?.(message) },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => onDelete?.(message) },
  ];

  return (
    <>
      <Pressable
        onLayout={onLayout}
        onPress={onPress}
        onLongPress={() => setActionsOpen(true)}
        delayLongPress={220}
        style={[styles.wrap, cornerStyle, { height }]}
      >
        {!thumbLoaded ? (
          <Animated.View
            style={[StyleSheet.absoluteFillObject, cornerStyle, { backgroundColor: colors.surfaceRaised, opacity: shimmer }]}
          />
        ) : null}
        {boxWidth ? (
          <Image
            source={{ uri: attachment.thumbnailUri || attachment.uri }}
            style={[StyleSheet.absoluteFillObject, cornerStyle]}
            resizeMode="cover"
            onLoadEnd={() => setThumbLoaded(true)}
          />
        ) : null}

        {thumbLoaded ? <View style={[StyleSheet.absoluteFillObject, styles.dim]} /> : null}

        {thumbLoaded && isDownloaded ? (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
          </View>
        ) : null}

        {thumbLoaded && isDownloading ? (
          <View style={styles.playBadge}>
            <UploadRing
              size={52}
              progress={download.progress}
              status="uploading"
              dark
              onCancel={() => onCancelDownload?.(message)}
            />
          </View>
        ) : null}

        {thumbLoaded && downloadFailed ? (
          <View style={styles.playBadge}>
            <UploadRing size={52} status="failed" dark onRetry={() => onRetryDownload?.(message)} />
          </View>
        ) : null}

        {thumbLoaded && notStarted ? (
          <View style={styles.playBadge}>
            <Ionicons name="arrow-down" size={24} color="#FFFFFF" />
          </View>
        ) : null}

        {thumbLoaded && notStarted && attachment.size != null ? (
          <View style={styles.sizeBadge}>
            <Text style={styles.sizeText}>{formatBytes(attachment.size)}</Text>
          </View>
        ) : null}

        {thumbLoaded && attachment.duration != null && !notStarted ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(attachment.duration)}</Text>
          </View>
        ) : null}

        {!hasCaption && thumbLoaded ? (
          <View style={styles.metaOverlay}>{renderMeta?.()}</View>
        ) : null}
      </Pressable>

      <VideoViewer
        visible={viewerOpen}
        uri={attachment.localUri || attachment.uri}
        posterUri={attachment.thumbnailUri}
        senderName={message?.senderName}
        onClose={() => setViewerOpen(false)}
        onReply={() => { setViewerOpen(false); onOpenReply?.(message); }}
        onForward={() => { setViewerOpen(false); onForward?.(message); }}
        onShare={() => onShare?.(message)}
        onDownload={() => onDownload?.(message)}
        onSave={() => onSave?.(message)}
        onDelete={() => { setViewerOpen(false); onDelete?.(message); }}
      />

      <ActionSheet visible={actionsOpen} onClose={() => setActionsOpen(false)} actions={actions} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', minHeight: 140, overflow: 'hidden', backgroundColor: '#00000010' },
  dim: { backgroundColor: 'rgba(0,0,0,0.12)' },
  playBadge: {
    position: 'absolute', top: '50%', left: '50%',
    width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute', left: 8, bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  sizeBadge: {
    position: 'absolute', top: '50%', left: '50%', marginTop: 18,
    transform: [{ translateX: -30 }],
  },
  sizeText: { ...type.small, color: '#FFFFFF', fontWeight: '600' },
  metaOverlay: {
    position: 'absolute', right: 6, bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
    flexDirection: 'row', alignItems: 'center',
  },
});
