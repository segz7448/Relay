import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type, space, avatarPalette, useTheme } from '../../../../../theme';
import { fetchBot, fetchBotUser } from '../../../../../botsApi';
import { fetchUserMessages, sendUserMessage } from '../../../../../botUserMessagesApi';
import MessageBubble from '../../../../../components/MessageBubble';
import Composer from '../../../../../components/Composer';
import { SkeletonBox, SkeletonCircle } from '../../../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../../../components/StateViews';
import { useToast } from '../../../../../components/Toast';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

export default function BotUserHistoryScreen() {
  const { id, userId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();

  const [bot, setBot] = useState(null);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'

  const load = useCallback(async () => {
    try {
      const [b, u, m] = await Promise.all([
        fetchBot(id),
        fetchBotUser(id, userId),
        fetchUserMessages(id, userId),
      ]);
      setBot(b);
      setUser(u);
      setMessages(m);
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  function handleSend(text) {
    // Note: "in"/"out" here follow the bot's own thread convention — "in"
    // is the end user messaging the bot, "out" is a reply from the bot
    // (i.e. from this admin panel, sent as the bot).
    const optimistic = { id: `um_local_${Date.now()}`, dir: 'out', text, createdAt: Date.now(), status: 'sending' };
    setMessages((list) => [...list, optimistic]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    sendUserMessage(id, userId, text)
      .then((saved) => {
        setMessages((list) => list.map((m) => (m.id === optimistic.id ? { ...saved, status: 'delivered' } : m)));
      })
      .catch(() => {
        setMessages((list) => list.map((m) => (m.id === optimistic.id ? { ...m, status: 'failed' } : m)));
        toast.error("Message couldn't be sent");
      });
  }

  const avatarColor = user ? hashColor(user.id) : colors.surfaceRaised;
  const initial = user ? user.name.trim().slice(0, 1).toUpperCase() : '';

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <View style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </View>
          <View style={styles.identity}>
            <SkeletonCircle size={34} />
            <View style={{ marginLeft: space.sm, gap: 6 }}>
              <SkeletonBox width={120} height={13} />
              <SkeletonBox width={90} height={10} />
            </View>
          </View>
        </View>
        <View style={{ padding: space.lg, gap: space.md }}>
          <SkeletonBox width="60%" height={36} radius={16} />
          <SkeletonBox width="45%" height={30} radius={16} style={{ alignSelf: 'flex-end' }} />
          <SkeletonBox width="55%" height={36} radius={16} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.accent} />
          </Pressable>
        </View>
        <ErrorState message="Couldn't load this conversation." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>

        <Pressable style={styles.identity} onPress={() => router.push(`/bot/${id}/user/${userId}`)}>
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.nameCol}>
            <Text style={styles.name} numberOfLines={1}>{user?.name ?? ''}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {user ? `@${user.username} · via ${bot?.name ?? 'bot'}` : ''}
            </Text>
          </View>
        </Pressable>

        <Pressable hitSlop={8} style={styles.headerBtn} onPress={() => router.push(`/bot/${id}/user/${userId}`)}>
          <Ionicons name="information-circle-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.listContent, !messages.length && { flex: 1 }]}
          renderItem={({ item }) => <MessageBubble message={item} />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <EmptyState icon="chatbubble-ellipses-outline" title="No messages yet" message="Replies sent from here go out to this person as the bot." />
          }
        />

        <Composer onSend={handleSend} onAttach={() => {}} />
      </KeyboardAvoidingView>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.sm,
      paddingBottom: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    backBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    identity: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 2 },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 13, fontWeight: '600' },
    nameCol: { marginLeft: space.sm, flexShrink: 1 },
    name: { ...type.h2, fontSize: 16, color: colors.textPrimary },
    subtitle: { ...type.small, color: colors.textMuted, marginTop: 1 },
    headerBtn: { padding: 4 },
    listContent: { paddingVertical: space.md, flexGrow: 1 },
  });
}
