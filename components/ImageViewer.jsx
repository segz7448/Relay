import { useMemo, useRef, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  Animated,
  PanResponder,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import ActionSheet from './ActionSheet';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 260;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.9;

function dist(touches) {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}
function midpoint(touches) {
  const [a, b] = touches;
  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}

// One page of the viewer: a single image that owns its own pinch-zoom,
// pan, and double-tap state. Vertical drag while at rest (1x) is read
// as "swipe to dismiss" and bubbles up via onDragProgress/onDismiss;
// everything else (pinch, pan-while-zoomed, double tap) stays local.
// Horizontal swipe between images is left to the parent ScrollView —
// this responder only takes over once it's confident the gesture isn't
// a page swipe (two touches, or a clearly vertical single-finger drag).
function ZoomableImage({ uri, active, onDragProgress, onDismiss, onRequestScrollLock }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY()).current;
  const scaleValue = useRef(1);
  const translateValue = useRef({ x: 0, y: 0 });
  const pinchOrigin = useRef(null);
  const lastTap = useRef(0);
  const gestureMode = useRef(null); // 'pinch' | 'pan' | 'dismiss' | null

  useMemo(() => {
    scale.addListener(({ value }) => (scaleValue.current = value));
    translate.addListener((v) => (translateValue.current = v));
  }, [scale, translate]);

  const resetIfSettled = useCallback((animated = true) => {
    gestureMode.current = null;
    onRequestScrollLock?.(false);
    const anims = [
      Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 6 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 6 }),
    ];
    if (animated) Animated.parallel(anims).start();
    else {
      translate.setValue({ x: 0, y: 0 });
      scale.setValue(1);
    }
  }, [scale, translate]);

  const zoomTo = useCallback((target, focal) => {
    onRequestScrollLock?.(target > 1);
    const dx = focal ? (SCREEN_W / 2 - focal.x) * (target - 1) : 0;
    const dy = focal ? (SCREEN_H / 2 - focal.y) * (target - 1) : 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: target, useNativeDriver: true, bounciness: 4 }),
      Animated.spring(translate, { toValue: { x: dx, y: dy }, useNativeDriver: true, bounciness: 4 }),
    ]).start();
  }, [scale, translate, onRequestScrollLock]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (evt, g) => {
        if (evt.nativeEvent.touches.length === 2) return true;
        if (scaleValue.current > 1.02) return true;
        // At rest: only steal the gesture from the horizontal ScrollView
        // once the drag is unmistakably vertical.
        return Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
      },
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          gestureMode.current = 'pinch';
          pinchOrigin.current = { d: dist(evt.nativeEvent.touches), s: scaleValue.current };
        } else if (scaleValue.current > 1.02) {
          gestureMode.current = 'pan';
          translate.setOffset(translateValue.current);
          translate.setValue({ x: 0, y: 0 });
        } else {
          gestureMode.current = 'dismiss';
        }
      },
      onPanResponderMove: (evt, g) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          if (gestureMode.current !== 'pinch') {
            gestureMode.current = 'pinch';
            pinchOrigin.current = { d: dist(touches), s: scaleValue.current };
          }
          const ratio = dist(touches) / (pinchOrigin.current?.d || 1);
          const next = Math.max(1, Math.min(MAX_SCALE, (pinchOrigin.current?.s || 1) * ratio));
          scale.setValue(next);
          onRequestScrollLock?.(next > 1.02);
          return;
        }
        if (gestureMode.current === 'pan') {
          translate.setValue({ x: g.dx, y: g.dy });
        } else if (gestureMode.current === 'dismiss') {
          translate.setValue({ x: g.dx * 0.4, y: g.dy });
          onDragProgress?.(Math.min(1, Math.abs(g.dy) / 300));
        }
      },
      onPanResponderRelease: (evt, g) => {
        if (gestureMode.current === 'pinch') {
          if (scaleValue.current < 1) zoomTo(1, null);
          else onRequestScrollLock?.(scaleValue.current > 1.02);
          gestureMode.current = null;
          return;
        }
        if (gestureMode.current === 'pan') {
          translate.flattenOffset();
          gestureMode.current = null;
          return;
        }
        if (gestureMode.current === 'dismiss') {
          const shouldDismiss = Math.abs(g.dy) > DISMISS_DISTANCE || Math.abs(g.vy) > DISMISS_VELOCITY;
          onDragProgress?.(0);
          if (shouldDismiss) {
            onDismiss?.();
            return;
          }
          resetIfSettled();
          return;
        }
        // A plain tap (no drag registered as a gesture mode): check for double tap.
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          if (scaleValue.current > 1.02) zoomTo(1, null);
          else {
            const t = evt.nativeEvent.touches[0] || { pageX: SCREEN_W / 2, pageY: SCREEN_H / 2 };
            zoomTo(DOUBLE_TAP_SCALE, { x: t.pageX, y: t.pageY });
          }
        } else {
          lastTap.current = now;
        }
      },
    })
  ).current;

  return (
    <View style={styles.page} {...panResponder.panHandlers}>
      <Animated.Image
        source={{ uri }}
        resizeMode="contain"
        style={[
          styles.pageImage,
          { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
        ]}
      />
    </View>
  );
}

// Telegram-for-iOS media viewer: black stage, chrome that fades as you
// drag an image down to dismiss, horizontal paging between the items in
// a message group, and the same reply/forward/share/delete/download/save
// action set Telegram surfaces from the overflow (•••) menu.
export default function ImageViewer({
  visible,
  images = [], // [{ uri, width, height }]
  initialIndex = 0,
  senderName,
  timeLabel,
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
  const [index, setIndex] = useState(initialIndex);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const backdrop = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef(null);

  const onDragProgress = useCallback((p) => {
    backdrop.setValue(1 - p * 0.85);
  }, [backdrop]);

  if (!images.length) return null;
  const current = images[Math.min(index, images.length - 1)];

  const actions = [
    { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', onPress: () => onReply?.(current, index) },
    { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => onForward?.(current, index) },
    { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => onShare?.(current, index) },
    { key: 'save', label: 'Save to Photos', icon: 'image-outline', onPress: () => onSave?.(current, index) },
    { key: 'download', label: 'Download', icon: 'cloud-download-outline', onPress: () => onDownload?.(current, index) },
    { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => onDelete?.(current, index) },
  ];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Animated.View style={[styles.root, { opacity: backdrop }]}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={!scrollLocked}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
            setIndex(i);
          }}
          contentOffset={{ x: initialIndex * SCREEN_W, y: 0 }}
        >
          {images.map((img, i) => (
            <ZoomableImage
              key={img.uri ?? i}
              uri={img.uri}
              active={i === index}
              onDragProgress={onDragProgress}
              onDismiss={onClose}
              onRequestScrollLock={setScrollLocked}
            />
          ))}
        </Animated.ScrollView>

        <View style={[styles2.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={10} style={styles2.topBtn}>
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles2.topTitle}>
            {senderName ? <Text style={styles2.topName} numberOfLines={1}>{senderName}</Text> : null}
            <Text style={styles2.topMeta} numberOfLines={1}>
              {images.length > 1 ? `${index + 1} of ${images.length}` : timeLabel}
            </Text>
          </View>
          <Pressable onPress={() => setActionsOpen(true)} hitSlop={10} style={styles2.topBtn}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={[styles2.bottomBar, { paddingBottom: insets.bottom + space.sm }]} pointerEvents="box-none">
          <Pressable onPress={() => onReply?.(current, index)} style={styles2.bottomBtn} hitSlop={8}>
            <Ionicons name="arrow-undo-outline" size={22} color="#FFFFFF" />
            <Text style={styles2.bottomLabel}>Reply</Text>
          </Pressable>
          <Pressable onPress={() => onForward?.(current, index)} style={styles2.bottomBtn} hitSlop={8}>
            <Ionicons name="arrow-redo-outline" size={22} color="#FFFFFF" />
            <Text style={styles2.bottomLabel}>Forward</Text>
          </Pressable>
          <Pressable onPress={() => onShare?.(current, index)} style={styles2.bottomBtn} hitSlop={8}>
            <Ionicons name="share-outline" size={22} color="#FFFFFF" />
            <Text style={styles2.bottomLabel}>Share</Text>
          </Pressable>
          <Pressable onPress={() => onDelete?.(current, index)} style={styles2.bottomBtn} hitSlop={8}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
            <Text style={[styles2.bottomLabel, { color: colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      </Animated.View>

      <ActionSheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        actions={actions}
      />
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
    topMeta: { ...type.small, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
    bottomBar: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      flexDirection: 'row', justifyContent: 'space-around',
      paddingTop: space.sm,
    },
    bottomBtn: { alignItems: 'center', gap: 3, paddingHorizontal: space.md },
    bottomLabel: { ...type.small, color: '#FFFFFF' },
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  page: { width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center' },
  pageImage: { width: SCREEN_W, height: SCREEN_H },
});
