import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Animated, PanResponder, View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import { fileVisualFor, formatBytes, formatSpeed, formatDuration } from '../utils/fileTypes';
import { groupReactions } from '../utils/reactions';
import { hapticTap, hapticBurst } from '../utils/haptics';
import UploadRing from './UploadRing';
import ImageMessage from './ImageMessage';
import VideoMessage from './VideoMessage';
import VoiceMessage from './VoiceMessage';

const DOUBLE_TAP_DELAY = 240;
const DEFAULT_REACTION = '❤️';
const SWIPE_THRESHOLD = 64;

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function StatusTicksOnPhoto({ status }) {
  if (status === 'sending') return <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.85)" />;
  if (status === 'failed') return <Ionicons name="alert-circle" size={12} color="#FF6B5B" />;
  if (status === 'read') return <Ionicons name="checkmark-done" size={14} color="#7CC4FF" />;
  if (status === 'delivered') return <Ionicons name="checkmark-done" size={14} color="rgba(255,255,255,0.85)" />;
  return <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.85)" />;
}

function StatusTicks({ status, onAccentMuted, danger }) {
  if (status === 'sending') return <Ionicons name="time-outline" size={13} color={onAccentMuted} />;
  if (status === 'failed') return <Ionicons name="alert-circle" size={13} color={danger} />;
  if (status === 'read') return <Ionicons name="checkmark-done" size={15} color="#3D9BFF" />;
  if (status === 'delivered') return <Ionicons name="checkmark-done" size={15} color={onAccentMuted} />;
  return <Ionicons name="checkmark" size={15} color={onAccentMuted} />;
}

function AttachmentContent({
  attachment, upload, isOut, colors, styles, onCancelUpload, onRetryUpload,
  message, hasCaption, renderPhotoMeta, onReply, onForward, onShare, onDownload, onSave, onDelete,
  download, onStartDownload, onCancelDownload, onRetryDownload,
}) {
  if (!attachment) return null;
  const uploading = upload && upload.status !== 'done';

  if (attachment.kind === 'image' && !uploading) {
    return (
      <ImageMessage
        attachment={attachment}
        isOut={isOut}
        hasCaption={hasCaption}
        renderMeta={renderPhotoMeta}
        message={message}
        onOpenReply={onReply}
        onForward={onForward}
        onShare={onShare}
        onDownload={onDownload}
        onSave={onSave}
        onDelete={onDelete}
      />
    );
  }

  if (attachment.kind === 'video' && !uploading) {
    return (
      <VideoMessage
        attachment={attachment}
        isOut={isOut}
        hasCaption={hasCaption}
        renderMeta={renderPhotoMeta}
        message={message}
        download={download}
        onStartDownload={onStartDownload}
        onCancelDownload={onCancelDownload}
        onRetryDownload={onRetryDownload}
        onOpenReply={onReply}
        onForward={onForward}
        onShare={onShare}
        onDownload={onDownload}
        onSave={onSave}
        onDelete={onDelete}
      />
    );
  }

  if (attachment.kind === 'voice' && !uploading) {
    return (
      <VoiceMessage
        attachment={attachment}
        isOut={isOut}
        message={message}
        download={download}
        onStartDownload={onStartDownload}
        onCancelDownload={onCancelDownload}
        onRetryDownload={onRetryDownload}
        onOpenReply={onReply}
        onForward={onForward}
        onShare={onShare}
        onSave={onSave}
        onDelete={onDelete}
      />
    );
  }

  if (attachment.kind === 'image' || attachment.kind === 'video') {
    return (
      <View style={styles.mediaWrap}>
        {attachment.uri ? (
          <Image source={{ uri: attachment.uri, headers: attachment.headers }} style={styles.mediaImage} resizeMode="cover" />
        ) : (
          <View style={[styles.mediaImage, styles.mediaFallback]}>
            <Ionicons name={attachment.kind === 'video' ? 'videocam' : 'image'} size={28} color={colors.textMuted} />
          </View>
        )}
        {attachment.kind === 'video' && !uploading ? (
          <View style={styles.playOverlay}>
            <Ionicons name="play" size={20} color="#FFFFFF" />
          </View>
        ) : null}
        {attachment.kind === 'video' && attachment.duration != null ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(attachment.duration)}</Text>
          </View>
        ) : null}
        {uploading ? (
          <View style={styles.mediaUploadOverlay}>
            <UploadRing
              size={48}
              progress={upload.progress}
              status={upload.status}
              dark
              onCancel={() => onCancelUpload?.()}
              onRetry={() => onRetryUpload?.()}
            />
          </View>
        ) : null}
      </View>
    );
  }

  if (attachment.kind === 'contact') {
    return (
      <View style={[styles.fileRow, isOut && styles.fileRowOut]}>
        <View style={[styles.fileIconBox, { backgroundColor: colors.online }]}>
          <Ionicons name="person" size={22} color="#FFFFFF" />
        </View>
        <View style={styles.fileTextCol}>
          <Text style={[styles.fileName, isOut && styles.textOut]} numberOfLines={1}>{attachment.contact?.name}</Text>
          <Text style={[styles.fileSub, isOut && styles.metaOut]} numberOfLines={1}>{attachment.contact?.phone}</Text>
        </View>
      </View>
    );
  }

  if (attachment.kind === 'location') {
    return (
      <View style={styles.locationCard}>
        <View style={styles.locationMap}>
          <Ionicons name="location" size={26} color="#FFFFFF" />
        </View>
        <View style={[styles.fileTextCol, { paddingHorizontal: space.md, paddingBottom: space.sm }]}>
          <Text style={[styles.fileName, isOut && styles.textOut]}>Location</Text>
          <Text style={[styles.fileSub, isOut && styles.metaOut]} numberOfLines={1}>
            {attachment.coords ? `${attachment.coords.lat.toFixed(4)}, ${attachment.coords.lng.toFixed(4)}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  const visual = fileVisualFor(attachment.ext);
  const isAudio = attachment.kind === 'audio' || attachment.kind === 'voice';
  const subtitle = uploading
    ? upload.status === 'failed'
      ? 'Failed · tap to retry'
      : `${Math.round((upload.progress ?? 0) * 100)}% · ${formatSpeed(upload.speed ?? 0)} · ${formatBytes(upload.remaining ?? 0)} left`
    : isAudio
      ? `${formatDuration(attachment.duration)} · ${visual.label}`
      : `${formatBytes(attachment.size)} · ${(attachment.ext || '').toUpperCase() || 'FILE'}`;

  return (
    <View style={[styles.fileRow, isOut && styles.fileRowOut]}>
      <View style={[styles.fileIconBox, { backgroundColor: visual.color }]}>
        {isAudio ? (
          <Ionicons name={attachment.kind === 'voice' ? 'mic' : 'play'} size={20} color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name={visual.icon} size={24} color="#FFFFFF" />
        )}
        {uploading ? (
          <View style={StyleSheet.absoluteFillObject}>
            <UploadRing
              size={44}
              progress={upload.progress}
              status={upload.status}
              onCancel={() => onCancelUpload?.()}
              onRetry={() => onRetryUpload?.()}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.fileTextCol}>
        <Text style={[styles.fileName, isOut && styles.textOut]} numberOfLines={1}>{attachment.name}</Text>
        <Text style={[styles.fileSub, isOut && styles.metaOut, upload?.status === 'failed' && { color: colors.danger }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export default function MessageBubble({
  message,
  replyPreviewText,
  replyPreviewAuthor,
  selectable,
  selected,
  onPress,
  onLongPress,
  onToggleSelect,
  onCancelUpload,
  onRetryUpload,
  onReply,
  onForward,
  onShare,
  onDownload,
  onSave,
  onDelete,
  onStartDownload,
  onCancelDownload,
  onRetryDownload,
  onReact,
  onViewReactions,
  onDoubleTap,
  onSwipeReply,
  onPressReplyBar,
  highlighted,
}) {
  const { colors, glow, fontScale, animationsEnabled } = useTheme();
  const styles = useMemo(() => getStyles(colors, glow, fontScale), [colors, glow, fontScale]);
  const scale = useRef(new Animated.Value(1)).current;
  const burstScale = useRef(new Animated.Value(0.3)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;
  const [burstEmoji, setBurstEmoji] = useState(DEFAULT_REACTION);
  const lastTapRef = useRef(0);
  const singleTapTimer = useRef(null);
  const reactionGroups = useMemo(() => groupReactions(message.reactions), [message.reactions]);
  const isOut = message.dir === 'out';

  // ── Swipe-to-reply ──────────────────────────────────────────────────
  // Refs let the PanResponder (created once) always see current props
  // without going stale from the initial closure.
  const swipeX = useRef(new Animated.Value(0)).current;
  const replyTriggeredRef = useRef(false);
  const onSwipeReplyRef = useRef(onSwipeReply);
  const messageRef = useRef(message);
  const selectableRef = useRef(selectable);
  onSwipeReplyRef.current = onSwipeReply;
  messageRef.current = message;
  selectableRef.current = selectable;

  const replyIconOpacity = useMemo(
    () => swipeX.interpolate({ inputRange: [0, 16, SWIPE_THRESHOLD], outputRange: [0, 0.4, 1], extrapolate: 'clamp' }),
    [swipeX],
  );
  const replyIconScale = useMemo(
    () => swipeX.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0.5, 1], extrapolate: 'clamp' }),
    [swipeX],
  );

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture when it's a clear rightward horizontal swipe
      // and we're not in select mode. This lets vertical FlatList scrolling
      // and normal taps pass through unaffected.
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        !selectableRef.current && dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.5,
      onPanResponderGrant: () => {
        replyTriggeredRef.current = false;
      },
      onPanResponderMove: (_, { dx }) => {
        // Clamp: allow a little overshoot for springiness, not unlimited drag
        const x = Math.min(Math.max(dx, 0), SWIPE_THRESHOLD + 20);
        swipeX.setValue(x);
        // Fire haptic + mark trigger once we cross the threshold
        if (x >= SWIPE_THRESHOLD && !replyTriggeredRef.current) {
          replyTriggeredRef.current = true;
          hapticTap();
        }
      },
      onPanResponderRelease: () => {
        if (replyTriggeredRef.current) {
          onSwipeReplyRef.current?.(messageRef.current);
        }
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 8 }).start();
        replyTriggeredRef.current = false;
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
        replyTriggeredRef.current = false;
      },
    }),
  ).current;

  // ── Highlight (jump-to target flash) ────────────────────────────────
  const highlightOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (highlighted) {
      if (!animationsEnabled) {
        // Still a real, brief highlight — just a plain show/hide, no tween.
        highlightOpacity.setValue(0.28);
        const t = setTimeout(() => highlightOpacity.setValue(0), 900);
        return () => clearTimeout(t);
      }
      highlightOpacity.setValue(0.28);
      Animated.timing(highlightOpacity, { toValue: 0, duration: 1400, delay: 150, useNativeDriver: true }).start();
    }
  }, [highlighted, animationsEnabled]);

  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
  }, []);

  const isFailed = message.status === 'failed';
  const hasCaption = !!message.text;
  const isUploadingAttachment = message.upload && message.upload.status !== 'done';
  const bareBubble =
    (message.attachment?.kind === 'image' || message.attachment?.kind === 'video') && !isUploadingAttachment;
  const onAccentMuted = 'rgba(26,16,6,0.55)';

  function onPressIn() {
    if (!animationsEnabled) return;
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }
  function onPressOut() {
    if (!animationsEnabled) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
  }

  function playBurst(emoji) {
    if (!animationsEnabled) return;
    setBurstEmoji(emoji);
    burstScale.setValue(0.4);
    burstOpacity.setValue(1);
    Animated.spring(burstScale, { toValue: 1.5, useNativeDriver: true, speed: 14, bounciness: 12 }).start();
    Animated.sequence([
      Animated.delay(260),
      Animated.timing(burstOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }

  function handleDoubleTap() {
    hapticBurst();
    playBurst(DEFAULT_REACTION);
    onDoubleTap?.(message);
  }

  function handleBubblePress() {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      lastTapRef.current = 0;
      handleDoubleTap();
    } else {
      lastTapRef.current = now;
      singleTapTimer.current = setTimeout(() => {
        onPress?.(message);
      }, DOUBLE_TAP_DELAY);
    }
  }

  // ── Reply bar (shown when message has a replyTo) ─────────────────────
  // Wrapped in a Pressable so tapping it scrolls to the quoted original.
  const replyBarContent = message.replyTo && replyPreviewText ? (
    <Pressable onPress={() => onPressReplyBar?.(message.replyTo)} hitSlop={4}>
      <View style={bareBubble ? styles.captionPadTop : null}>
        <View style={styles.replyBar}>
          <View style={[styles.replyStripe, isOut && styles.replyStripeOut]} />
          <View style={styles.replyContent}>
            {replyPreviewAuthor ? (
              <Text style={[styles.replyAuthor, isOut && styles.replyAuthorOut]} numberOfLines={1}>
                {replyPreviewAuthor}
              </Text>
            ) : null}
            <Text style={[styles.replyText, isOut && styles.replyTextOut]} numberOfLines={1}>
              {replyPreviewText}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  ) : null;

  return (
    <View style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}>
      {selectable ? (
        <Pressable
          hitSlop={8}
          onPress={() => onToggleSelect?.(message)}
          style={[styles.checkbox, selected && styles.checkboxOn, isOut ? { marginLeft: space.sm } : { marginRight: space.sm }]}
        >
          {selected ? <Ionicons name="checkmark" size={13} color={colors.onAccent} /> : null}
        </Pressable>
      ) : null}

      {/* Reply icon — revealed as the bubble slides right. Absolutely
          positioned in the row (full-width) at the left edge, so it
          appears for both incoming and outgoing messages just like iOS
          Telegram. */}
      {!selectable ? (
        <Animated.View
          style={[
            styles.swipeReplyIcon,
            { opacity: replyIconOpacity, transform: [{ scale: replyIconScale }] },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="arrow-undo" size={17} color={colors.accent} />
        </Animated.View>
      ) : null}

      {/* Bubble — translates right on swipe via swipeX. The panHandlers
          sit on this wrapper so the FlatList's vertical scroll still
          wins on clearly vertical gestures. */}
      <Animated.View
        style={{ transform: [{ scale }, { translateX: swipeX }], maxWidth: '78%' }}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => (selectable ? onToggleSelect?.(message) : handleBubblePress())}
          onLongPress={() => onLongPress?.(message)}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          delayLongPress={220}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.burstOverlay, { opacity: burstOpacity, transform: [{ scale: burstScale }] }]}
          >
            <Text style={styles.burstEmoji}>{burstEmoji}</Text>
          </Animated.View>

          <View
            style={[
              styles.bubble,
              isOut ? styles.bubbleOut : styles.bubbleIn,
              isFailed && styles.bubbleFailed,
              bareBubble && styles.bubbleBare,
            ]}
          >
            {/* Jump-to highlight overlay — fades out after scroll */}
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  backgroundColor: colors.accent,
                  opacity: highlightOpacity,
                  borderRadius: radius.lg,
                  zIndex: 5,
                },
              ]}
            />

            {message.forwardedFrom ? (
              <View style={bareBubble ? styles.captionPadTop : styles.forwardedRow}>
                <Ionicons name="arrow-redo-outline" size={12} color={isOut ? styles.forwardedOut.color : styles.forwarded.color} />
                <Text style={[styles.forwarded, isOut && styles.forwardedOut]}>
                  Forwarded from {message.forwardedFrom}
                </Text>
              </View>
            ) : null}

            {replyBarContent}

            {message.attachment ? (
              <AttachmentContent
                attachment={message.attachment}
                upload={message.upload}
                isOut={isOut}
                colors={colors}
                styles={styles}
                onCancelUpload={() => onCancelUpload?.(message)}
                onRetryUpload={() => onRetryUpload?.(message)}
                message={message}
                hasCaption={hasCaption}
                renderPhotoMeta={() => (
                  <>
                    {message.edited ? <Text style={styles.editedOnPhoto}>edited</Text> : null}
                    <Text style={styles.timeOnPhoto}>{timeLabel(message.createdAt)}</Text>
                    {isOut ? (
                      <View style={{ marginLeft: 4 }}>
                        <StatusTicksOnPhoto status={message.status} />
                      </View>
                    ) : null}
                  </>
                )}
                onReply={() => onReply?.(message)}
                onForward={() => onForward?.(message)}
                onShare={() => onShare?.(message)}
                onDownload={() => onDownload?.(message)}
                onSave={() => onSave?.(message)}
                onDelete={() => onDelete?.(message)}
                download={message.download}
                onStartDownload={() => onStartDownload?.(message)}
                onCancelDownload={() => onCancelDownload?.(message)}
                onRetryDownload={() => onRetryDownload?.(message)}
              />
            ) : null}

            {message.text ? (
              <Text
                style={[
                  styles.text,
                  isOut && styles.textOut,
                  message.attachment && { marginTop: space.sm },
                  bareBubble && styles.captionPad,
                ]}
              >
                {message.text}
              </Text>
            ) : null}

            {bareBubble && !hasCaption ? null : (
              <View style={[styles.metaRow, bareBubble && hasCaption && styles.captionPadBottom]}>
                {message.edited ? (
                  <Text style={[styles.edited, isOut && styles.metaOut]}>edited</Text>
                ) : null}
                {message.pinned ? (
                  <Ionicons
                    name="pin"
                    size={11}
                    color={isOut ? onAccentMuted : colors.textMuted}
                    style={{ marginRight: 4 }}
                  />
                ) : null}
                <Text style={[styles.time, isOut && styles.metaOut]}>{timeLabel(message.createdAt)}</Text>
                {isOut ? (
                  <View style={{ marginLeft: 4 }}>
                    <StatusTicks status={message.status} onAccentMuted={onAccentMuted} danger={colors.danger} />
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {reactionGroups.length ? (
            <View style={[styles.reactionsRow, isOut ? styles.reactionsRowOut : styles.reactionsRowIn]}>
              {reactionGroups.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => {
                    hapticTap();
                    onReact?.(message, r.emoji);
                  }}
                  onLongPress={() => onViewReactions?.(message)}
                  delayLongPress={220}
                  style={({ pressed }) => [
                    styles.reactionPill,
                    r.mine && styles.reactionPillMine,
                    pressed && { transform: [{ scale: 0.9 }] },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.count > 1 ? <Text style={[styles.reactionCount, r.mine && styles.reactionCountMine]}>{r.count}</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function getStyles(colors, glow, fontScale = 1) {
  return StyleSheet.create({
    row: { flexDirection: 'row', paddingHorizontal: space.md, marginVertical: 2, alignItems: 'flex-end' },
    rowOut: { justifyContent: 'flex-end' },
    rowIn: { justifyContent: 'flex-start' },
    checkbox: {
      width: 22, height: 22, borderRadius: 11, marginBottom: 4,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.border,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },

    // Swipe-to-reply icon — absolutely placed inside the full-width row
    // so it sits at the left margin for both incoming and outgoing.
    swipeReplyIcon: {
      position: 'absolute',
      left: space.md,
      bottom: 6,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    bubble: {
      borderRadius: radius.lg,
      paddingVertical: 7,
      paddingHorizontal: space.md,
      overflow: 'hidden',
    },
    bubbleBare: { paddingVertical: 0, paddingHorizontal: 0 },
    captionPad: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 2 },
    captionPadTop: { paddingHorizontal: space.md, paddingTop: 7 },
    captionPadBottom: { paddingHorizontal: space.md, paddingBottom: 7 },
    editedOnPhoto: { ...type.small, fontSize: 11, color: 'rgba(255,255,255,0.85)', fontStyle: 'italic', marginRight: 4 },
    timeOnPhoto: { ...type.small, fontSize: 11, color: 'rgba(255,255,255,0.92)' },
    bubbleIn: {
      backgroundColor: colors.bubbleIn,
      borderBottomLeftRadius: 4,
      borderWidth: colors.bubbleIn === '#FFFFFF' ? 1 : 0,
      borderColor: colors.border,
    },
    bubbleOut: {
      backgroundColor: colors.accent,
      borderBottomRightRadius: 4,
    },
    bubbleFailed: { borderWidth: 1, borderColor: colors.danger },

    // Reply bar — stripe + optional author name + preview text
    forwardedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
    forwarded: { ...type.small, fontSize: 11, color: colors.accent, fontWeight: '600', fontStyle: 'italic' },
    forwardedOut: { color: 'rgba(26,16,6,0.7)' },
    replyBar: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4, gap: 6 },
    replyContent: { flex: 1 },
    replyStripe: { width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: colors.textSecondary, marginTop: 1 },
    replyStripeOut: { backgroundColor: 'rgba(26,16,6,0.45)' },
    replyAuthor: { ...type.small, fontSize: 11, color: colors.accent, fontWeight: '700', marginBottom: 1 },
    replyAuthorOut: { color: 'rgba(26,16,6,0.7)' },
    replyText: { ...type.small, color: colors.textSecondary, flexShrink: 1 },
    replyTextOut: { color: 'rgba(26,16,6,0.65)' },

    text: { ...type.body, fontSize: type.body.fontSize * fontScale, color: colors.onBubbleIn, lineHeight: 19 * fontScale },
    textOut: { color: colors.onAccent },
    metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, marginLeft: space.md },
    time: { ...type.small, fontSize: 11, color: colors.textMuted },
    metaOut: { color: 'rgba(26,16,6,0.55)' },
    edited: { ...type.small, fontSize: 11, color: colors.textMuted, marginRight: 4, fontStyle: 'italic' },
    reactionsRow: { flexDirection: 'row', marginTop: 3, gap: 4 },
    reactionsRowIn: { justifyContent: 'flex-start' },
    reactionsRowOut: { justifyContent: 'flex-end' },
    reactionPill: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.xl,
      paddingHorizontal: 7, paddingVertical: 2,
    },
    reactionPillMine: { borderColor: colors.accent, backgroundColor: glow.accent },
    reactionEmoji: { fontSize: 12 },
    reactionCount: { ...type.small, fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
    reactionCountMine: { color: colors.accent },
    burstOverlay: {
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      alignItems: 'center', justifyContent: 'center', zIndex: 10,
    },
    burstEmoji: { fontSize: 56 },

    mediaWrap: { borderRadius: radius.md, overflow: 'hidden', width: 200, height: 200, backgroundColor: colors.surfaceRaised },
    mediaImage: { width: '100%', height: '100%' },
    mediaFallback: { alignItems: 'center', justifyContent: 'center' },
    mediaUploadOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    playOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'center',
    },
    durationBadge: {
      position: 'absolute', right: 6, bottom: 6,
      backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.sm,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },

    fileRow: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      minWidth: 190, paddingVertical: 2,
    },
    fileRowOut: {},
    fileIconBox: {
      width: 44, height: 44, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    fileTextCol: { flexShrink: 1 },
    fileName: { ...type.body, fontWeight: '600', color: colors.onBubbleIn },
    fileSub: { ...type.small, color: colors.textMuted, marginTop: 2 },

    locationCard: { width: 200, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
    locationMap: {
      height: 90, alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#2E9E5B',
    },
  });
}
