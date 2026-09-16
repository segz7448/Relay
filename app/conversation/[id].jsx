import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { type, space, avatarPalette, useTheme } from "../../theme";
import { api } from "../../api";
import { holdCallSession } from "../../callSession";
import { createPeer, microphoneStream, stopMedia } from "../../callEngine";
import {
  fetchConversation,
  fetchMessages,
  forwardMessage,
  reactToMessage,
  sendMessage,
} from "../../messagesApi";
import MessageBubble from "../../components/MessageBubble";
import Avatar from "../../components/Avatar";
import MessageActionSheet from "../../components/MessageActionSheet";
import EmojiPickerSheet from "../../components/EmojiPickerSheet";
import ReactionsViewSheet from "../../components/ReactionsViewSheet";
import Composer from "../../components/Composer";
import AttachmentSheet from "../../components/AttachmentSheet";
import FilePreviewSheet from "../../components/FilePreviewSheet";
import ContactPickerSheet from "../../components/ContactPickerSheet";
import ForwardSheet from "../../components/ForwardSheet";
import { extensionOf, mediaKindOf, guessMime } from "../../utils/fileTypes";
import { toggleReaction } from "../../utils/reactions";
import { SkeletonListRow } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/ConfirmDialog";

// --- Attachment pickers -----------------------------------------------

async function pickFromLibrary(wantVideo) {
  const ImagePicker = await import("expo-image-picker");
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: wantVideo
      ? ImagePicker.MediaTypeOptions.Videos
      : ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const name =
    asset.fileName ||
    asset.uri.split("/").pop() ||
    (wantVideo ? "video.mp4" : "photo.jpg");
  const ext = extensionOf(name) || (wantVideo ? "mp4" : "jpg");
  return {
    kind: wantVideo ? "video" : "image",
    name,
    ext,
    size: asset.fileSize ?? null,
    mime: asset.mimeType ?? guessMime(ext),
    uri: asset.uri,
    duration: asset.duration ? asset.duration / 1000 : null,
  };
}

async function pickFromCamera() {
  const ImagePicker = await import("expo-image-picker");
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const name = asset.fileName || `camera_${Date.now()}.jpg`;
  const ext = extensionOf(name) || "jpg";
  return {
    kind: mediaKindOf(ext) === "video" ? "video" : "image",
    name,
    ext,
    size: asset.fileSize ?? null,
    mime: asset.mimeType ?? guessMime(ext),
    uri: asset.uri,
    duration: asset.duration ? asset.duration / 1000 : null,
  };
}

async function pickDocument(audioOnly) {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: audioOnly ? "audio/*" : "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const ext = extensionOf(asset.name);
  return {
    kind: audioOnly ? "audio" : mediaKindOf(ext),
    name: asset.name,
    ext,
    size: asset.size ?? null,
    mime: asset.mimeType ?? guessMime(ext),
    uri: asset.uri,
    duration: null,
  };
}

async function pickCurrentLocation() {
  const Location = await import("expo-location");
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  const pos = await Location.getCurrentPositionAsync({});
  return {
    kind: "location",
    name: "Location",
    coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
  };
}

function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function statusLabel(convo) {
  if (!convo) return "";
  if (convo.typing) return "typing…";
  if (convo.online) return "online";
  return "last seen recently";
}

export default function ConversationScreen() {
  const { id, highlight, prefill } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const { colors, chatBackgroundColor } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const toast = useToast();
  const confirm = useConfirm();
  const [convo, setConvo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sheetFor, setSheetFor] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [reactionsViewFor, setReactionsViewFor] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  const [contactSheetVisible, setContactSheetVisible] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  // ID of the message to briefly highlight after jump-to-original
  const [highlightedId, setHighlightedId] = useState(null);
  const [forwardFor, setForwardFor] = useState(null); // message(s) staged in the Forward sheet
  const uploadTimers = useRef({});

  useEffect(() => {
    setLoadingMessages(true);
    fetchConversation(id)
      .catch(() => null)
      .then(setConvo);
    fetchMessages(id)
      .then(setMessages)
      .catch(() => toast.error("Couldn't load this conversation"))
      .finally(() => setLoadingMessages(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Arrived here from a search result — jump to and flash the matched
  // message once it's loaded, same highlight used for quoted replies.
  useEffect(() => {
    if (!highlight || messages.length === 0) return;
    const idx = messages.findIndex((m) => m.id === highlight);
    if (idx < 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.5,
      });
      setHighlightedId(highlight);
      setTimeout(() => setHighlightedId(null), 1600);
    }, 80);
    return () => clearTimeout(t);
    // Only meant to fire once per navigation, not on every message list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, messages.length]);

  useEffect(() => {
    return () => {
      Object.values(uploadTimers.current).forEach(clearInterval);
    };
  }, []);

  const byId = useMemo(
    () => Object.fromEntries(messages.map((m) => [m.id, m])),
    [messages],
  );
  const pinnedMessage = useMemo(
    () => messages.find((m) => m.pinned),
    [messages],
  );

  const patch = useCallback((msgId, changes) => {
    setMessages((list) =>
      list.map((m) => (m.id === msgId ? { ...m, ...changes } : m)),
    );
  }, []);

  function toggleSelect(message) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(message.id) ? next.delete(message.id) : next.add(message.id);
      return next;
    });
  }

  function exitSelection() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleSend(text) {
    if (editingId) {
      toast.error("Message editing is not supported by the server");
      setEditingId(null);
      return;
    }
    try {
      const saved = await sendMessage(id, { text, replyToId: replyingTo?.id });
      setMessages((list) => [...list, saved]);
      setReplyingTo(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (error) {
      toast.error(error.message || "Couldn't send message");
    }
  }

  function cancelUpload() {}
  function retryUpload() {}

  async function sendAttachmentMessage(attachment) {
    try {
      let attachmentUrl;
      if (attachment.uri) {
        const form = new FormData();
        form.append("file", {
          uri: attachment.uri,
          name: attachment.name,
          type: attachment.mime || "application/octet-stream",
        });
        const uploaded = await api.uploadFile(form);
        attachmentUrl = uploaded.url;
      }
      const saved = await sendMessage(id, {
        text: "",
        attachmentUrl,
        attachmentType: attachment.kind,
        attachmentName: attachment.name,
        attachmentSize: attachment.size,
      });
      setMessages((list) => [...list, saved]);
    } catch (error) {
      toast.error(error.message || "Couldn't send attachment");
    }
  }

  async function handleAttachSelect(key) {
    try {
      if (key === "photo") {
        const a = await pickFromLibrary(false);
        if (a) setPendingAttachment(a);
      } else if (key === "video") {
        const a = await pickFromLibrary(true);
        if (a) setPendingAttachment(a);
      } else if (key === "camera") {
        const a = await pickFromCamera();
        if (a) setPendingAttachment(a);
      } else if (key === "document") {
        const a = await pickDocument(false);
        if (a) setPendingAttachment(a);
      } else if (key === "file") {
        const a = await pickDocument(false);
        if (a) setPendingAttachment(a);
      } else if (key === "audio") {
        const a = await pickDocument(true);
        if (a) setPendingAttachment(a);
      } else if (key === "contact") {
        setContactSheetVisible(true);
      } else if (key === "location") {
        const a = await pickCurrentLocation();
        if (a) sendAttachmentMessage(a);
      }
    } catch (e) {
      // Picker unavailable or permission denied — silent no-op.
    }
  }

  async function react(messageOrId, emoji) {
    const msgId =
      typeof messageOrId === "string" ? messageOrId : messageOrId.id;
    const current = byId[msgId];
    if (!current) return;
    const optimistic = toggleReaction(current.reactions, emoji, "You");
    patch(msgId, { reactions: optimistic });
    try {
      const saved = await reactToMessage(id, msgId, emoji);
      patch(msgId, { reactions: saved.reactions });
    } catch (error) {
      patch(msgId, { reactions: current.reactions });
      toast.error(error.message || "Couldn't update reaction");
    }
  }

  function removeMineReaction(message) {
    const mine = message?.reactions?.find((r) => r.mine);
    if (mine) react(message, mine.emoji);
  }

  // ── Swipe-to-reply handler ───────────────────────────────────────────
  // Called by MessageBubble when the user drags past the threshold.
  // Mirrors the same author/text shape the action-sheet Reply uses so
  // Composer renders the preview identically either way.
  const handleSwipeReply = useCallback(
    (message) => {
      const isOut = message.dir === "out";
      setReplyingTo({
        id: message.id,
        author: isOut ? "yourself" : (convo?.name ?? "them"),
        text:
          message.text ||
          (message.attachment
            ? `📎 ${message.attachment.name || message.attachment.kind}`
            : "Message"),
      });
    },
    [convo],
  );

  // ── Tap-quoted-message → scroll to original ──────────────────────────
  // Briefly flashes the original message with a highlight overlay so
  // the user can see exactly which message they jumped to — the same
  // amber-tint-fade Telegram uses.
  const handlePressReplyBar = useCallback(
    (originalId) => {
      const idx = messages.findIndex((m) => m.id === originalId);
      if (idx < 0) return;

      listRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0.5,
      });

      setHighlightedId(originalId);
      setTimeout(() => setHighlightedId(null), 1600);
    },
    [messages],
  );

  const actionsFor = (message) => {
    const isOut = message.dir === "out";
    const base = [
      {
        key: "reply",
        label: "Reply",
        icon: "arrow-undo-outline",
        onPress: (m) =>
          setReplyingTo({
            id: m.id,
            author: isOut ? "yourself" : (convo?.name ?? "them"),
            text: m.text,
          }),
      },
      {
        key: "forward",
        label: "Forward",
        icon: "arrow-redo-outline",
        onPress: (m) => setForwardFor([m]),
      },
      {
        key: "copy",
        label: "Copy",
        icon: "copy-outline",
        onPress: async (m) => {
          if (!m.text) return;
          await Clipboard.setStringAsync(m.text);
          toast.success("Copied to clipboard");
        },
      },
    ];
    return base;
  };

  async function startVoiceCall() {
    if (!convo?.refId)
      return toast.error("This contact is not linked to a Relay user");
    let local;
    let peer;
    try {
      local = await microphoneStream();
      const queuedIce = [];
      const ice = await loadIceServers();
      peer = createPeer({ iceServers: ice.iceServers });
      peer.onicecandidate = (event) => {
        if (event.candidate) queuedIce.push(event.candidate.toJSON());
      };
      local.getTracks().forEach((track) => peer.addTrack(track, local));
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await peer.setLocalDescription(offer);
      const created = await api.startCall({ calleeId: convo.refId, offer });
      await Promise.all(
        queuedIce.map((candidate) => api.addCallIce(created.id, candidate)),
      );
      holdCallSession(created.id, {
        peer,
        stream: local,
        turnConfigured: ice.turnConfigured,
      });
      router.push(`/call/${created.id}`);
    } catch (error) {
      peer?.close();
      stopMedia(local);
      toast.error(error.message || "Could not start voice call");
    }
  }

  const editingMessage = editingId ? byId[editingId] : null;

  async function handleForward(targetIds) {
    const msgs = forwardFor ?? [];
    for (const m of msgs) {
      await forwardMessage(m, targetIds, convo?.name ?? "Unknown");
    }
    setForwardFor(null);
    const chatWord = targetIds.length === 1 ? "chat" : "chats";
    toast.success(`Sent to ${targetIds.length} ${chatWord}`);
  }

  return (
    <View
      style={[
        styles.screen,
        chatBackgroundColor ? { backgroundColor: chatBackgroundColor } : null,
      ]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        {selectMode ? (
          <>
            <Pressable
              onPress={exitSelection}
              hitSlop={10}
              style={styles.backBtn}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.selectionCount}>{selected.size} selected</Text>
            <Pressable
              onPress={async () => {
                const count = selected.size;
                const ok = await confirm({
                  title: "Delete messages?",
                  message: `Delete ${count} selected message${count === 1 ? "" : "s"}? This can't be undone.`,
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok) return;
                setMessages((list) => list.filter((m) => !selected.has(m.id)));
                exitSelection();
                toast.success(
                  `${count} message${count === 1 ? "" : "s"} deleted`,
                );
              }}
              hitSlop={10}
              disabled={selected.size === 0}
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color={selected.size ? colors.danger : colors.textMuted}
              />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={26} color={colors.accent} />
            </Pressable>

            <Pressable
              style={styles.identity}
              onPress={() => {
                if (convo?.kind === "bot") router.push(`/bot/${convo.id}`);
                else if (convo?.kind === "direct")
                  router.push(`/contact/${convo.id}`);
              }}
            >
              <Avatar uri={convo?.photoUrl} name={convo?.name} size={34} />
              <View style={styles.nameCol}>
                <Text style={styles.name} numberOfLines={1}>
                  {convo?.name ?? ""}
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    convo?.typing && { color: colors.accent },
                  ]}
                  numberOfLines={1}
                >
                  {convo?.username ? `@${convo.username} · ` : ""}
                  {statusLabel(convo)}
                </Text>
              </View>
            </Pressable>

            <View style={styles.headerActions}>
              {convo?.kind === "direct" ? (
                <Pressable
                  hitSlop={8}
                  style={styles.headerBtn}
                  onPress={startVoiceCall}
                  accessibilityLabel="Start voice call"
                >
                  <Ionicons
                    name="call-outline"
                    size={21}
                    color={colors.accent}
                  />
                </Pressable>
              ) : null}
              {convo?.kind === "bot" ? (
                <Pressable
                  hitSlop={8}
                  style={styles.headerBtn}
                  onPress={() => router.push(`/bot/${convo.id}`)}
                >
                  <Ionicons
                    name="hardware-chip-outline"
                    size={21}
                    color={colors.accent}
                  />
                </Pressable>
              ) : null}
              <Pressable
                hitSlop={8}
                style={styles.headerBtn}
                onPress={() => {
                  if (convo?.kind === "bot") router.push(`/bot/${convo.id}`);
                  else if (convo?.kind === "direct")
                    router.push(`/contact/${convo.id}`);
                }}
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={21}
                  color={colors.accent}
                />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {pinnedMessage ? (
        <Pressable
          style={styles.pinnedBar}
          onPress={() => {
            const idx = messages.findIndex((m) => m.id === pinnedMessage.id);
            if (idx >= 0)
              listRef.current?.scrollToIndex({ index: idx, animated: true });
          }}
        >
          <Ionicons name="pin" size={14} color={colors.accent} />
          <Text style={styles.pinnedText} numberOfLines={1}>
            {pinnedMessage.text}
          </Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        {loadingMessages ? (
          <View style={{ paddingTop: space.md }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonListRow key={i} />
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.listContent}
            // When jumping to an index that's outside the rendered window,
            // FlatList calls this with a best-guess offset so we can land
            // close enough for the second scrollToIndex attempt to succeed.
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              listRef.current?.scrollToOffset({
                offset: index * averageItemLength,
                animated: true,
              });
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index,
                  animated: true,
                  viewPosition: 0.5,
                });
              }, 120);
            }}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                // Reply preview: text + author name of the quoted message
                replyPreviewText={
                  item.replyTo ? (byId[item.replyTo]?.text ?? null) : null
                }
                replyPreviewAuthor={
                  item.replyTo
                    ? byId[item.replyTo]?.dir === "out"
                      ? "You"
                      : (convo?.name ?? "them")
                    : null
                }
                selectable={selectMode}
                selected={selected.has(item.id)}
                onLongPress={(m) => setSheetFor(m)}
                onToggleSelect={toggleSelect}
                onCancelUpload={cancelUpload}
                onRetryUpload={retryUpload}
                onReact={react}
                onDoubleTap={(m) => react(m, "❤️")}
                onViewReactions={(m) => setReactionsViewFor(m)}
                onForward={(m) => setForwardFor([m])}
                // Swipe-to-reply (slide gesture)
                onSwipeReply={handleSwipeReply}
                // Tap quoted preview → jump to original + flash highlight
                onPressReplyBar={handlePressReplyBar}
                highlighted={item.id === highlightedId}
              />
            )}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        <Composer
          onSend={handleSend}
          onAttach={() => setAttachSheetVisible(true)}
          onVoice={(attachment) => sendAttachmentMessage(attachment)}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          editingText={editingMessage?.text}
          initialText={prefill}
          onCancelEdit={() => setEditingId(null)}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={!!sheetFor}
        message={sheetFor}
        onClose={() => setSheetFor(null)}
        onReact={react}
        onOpenMore={(m) => {
          setSheetFor(null);
          setPickerFor(m);
        }}
        actions={sheetFor ? actionsFor(sheetFor) : []}
      />

      <EmojiPickerSheet
        visible={!!pickerFor}
        onClose={() => setPickerFor(null)}
        onSelect={(emoji) => {
          react(pickerFor, emoji);
          setPickerFor(null);
        }}
      />

      <ReactionsViewSheet
        visible={!!reactionsViewFor}
        message={reactionsViewFor}
        onClose={() => setReactionsViewFor(null)}
        onRemoveMine={() => removeMineReaction(reactionsViewFor)}
      />

      <AttachmentSheet
        visible={attachSheetVisible}
        onClose={() => setAttachSheetVisible(false)}
        onSelect={handleAttachSelect}
      />

      <FilePreviewSheet
        visible={!!pendingAttachment}
        attachment={pendingAttachment}
        onCancel={() => setPendingAttachment(null)}
        onSend={() => {
          const a = pendingAttachment;
          setPendingAttachment(null);
          if (a) sendAttachmentMessage(a);
        }}
      />

      <ContactPickerSheet
        visible={contactSheetVisible}
        onClose={() => setContactSheetVisible(false)}
        onPick={(contact) =>
          sendAttachmentMessage({
            kind: "contact",
            name: contact.name,
            contact,
          })
        }
      />

      <ForwardSheet
        visible={!!forwardFor}
        messages={forwardFor}
        onClose={() => setForwardFor(null)}
        onSend={handleForward}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: space.sm,
      paddingBottom: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    backBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    cancelText: { ...type.body, color: colors.accent },
    selectionCount: {
      ...type.h2,
      color: colors.textPrimary,
      flex: 1,
      textAlign: "center",
    },
    identity: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 2,
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: "#F2F4F6", fontSize: 13, fontWeight: "600" },
    nameCol: { marginLeft: space.sm, flexShrink: 1 },
    name: { ...type.h2, fontSize: 16, color: colors.textPrimary },
    subtitle: { ...type.small, color: colors.textMuted, marginTop: 1 },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginLeft: space.sm,
    },
    headerBtn: { padding: 4 },
    pinnedBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pinnedText: { ...type.small, color: colors.textSecondary, flex: 1 },
    listContent: { paddingVertical: space.md },
  });
}
