import { useMemo, useRef, useState, useCallback } from 'react';
import { View, Image, Pressable, Animated, StyleSheet } from 'react-native';
import { radius, useTheme } from '../theme';
import ActionSheet from './ActionSheet';
import ImageViewer from './ImageViewer';

const MIN_ASPECT = 0.66; // tallest we'll draw it (h/w)
const MAX_ASPECT = 1.4; // widest we'll draw it (h/w) — i.e. shortest height

// Telegram draws photo bubbles edge to edge: the image fills the full
// width of the bubble with no inner padding, corners match the bubble's
// own radius, and a translucent time/ticks pill sits directly on top of
// the bottom-right corner instead of a separate meta row underneath —
// but only when there's no caption; a captioned photo leaves room below
// for the text and the meta row moves there instead.
export default function ImageMessage({
  attachment,
  isOut,
  hasCaption,
  renderMeta,
  cornerRadius = radius.lg,
  message,
  onOpenReply,
  onForward,
  onShare,
  onDownload,
  onSave,
  onDelete,
}) {
  const { colors } = useTheme();
  const [boxWidth, setBoxWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
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

  const onLayout = useCallback((e) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - boxWidth) > 1) setBoxWidth(w);
  }, [boxWidth]);

  const rawAspect = attachment.height && attachment.width ? attachment.height / attachment.width : 0.85;
  const aspect = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, rawAspect));
  const height = boxWidth ? boxWidth * aspect : undefined;

  const cornerStyle = {
    borderRadius: cornerRadius,
    borderBottomLeftRadius: hasCaption ? 4 : (isOut ? cornerRadius : 4),
    borderBottomRightRadius: hasCaption ? 4 : (isOut ? 4 : cornerRadius),
  };

  const actions = [
    { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: () => onOpenReply?.(message) },
    { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => onForward?.(message) },
    { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => onShare?.(message) },
    { key: 'save', label: 'Save to Photos', icon: 'image-outline', onPress: () => onSave?.(message) },
    { key: 'download', label: 'Download', icon: 'cloud-download-outline', onPress: () => onDownload?.(message) },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => onDelete?.(message) },
  ];

  return (
    <>
      <Pressable
        onLayout={onLayout}
        onPress={() => setViewerOpen(true)}
        onLongPress={() => setActionsOpen(true)}
        delayLongPress={220}
        style={[styles.wrap, cornerStyle, { height }]}
      >
        {!loaded ? (
          <Animated.View
            style={[StyleSheet.absoluteFillObject, cornerStyle, styles.skeleton, { backgroundColor: colors.surfaceRaised, opacity: shimmer }]}
          />
        ) : null}
        {boxWidth ? (
          <Image
            source={{ uri: attachment.uri }}
            style={[StyleSheet.absoluteFillObject, cornerStyle]}
            resizeMode="cover"
            onLoadEnd={() => setLoaded(true)}
          />
        ) : null}

        {!hasCaption && loaded ? (
          <View style={styles.metaOverlay}>{renderMeta?.()}</View>
        ) : null}
      </Pressable>

      <ImageViewer
        visible={viewerOpen}
        images={[{ uri: attachment.uri, width: attachment.width, height: attachment.height }]}
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
  wrap: { width: '100%', minHeight: 120, overflow: 'hidden', backgroundColor: '#00000010' },
  skeleton: {},
  metaOverlay: {
    position: 'absolute', right: 6, bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
    flexDirection: 'row', alignItems: 'center',
  },
});
