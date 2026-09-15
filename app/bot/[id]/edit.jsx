import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../../../theme';
import Field from '../../../components/Field';
import { PrimaryButton } from '../../../components/Button';
import ActionSheet from '../../../components/ActionSheet';
import { SkeletonBox, SkeletonCircle } from '../../../components/Skeleton';
import { ErrorState } from '../../../components/StateViews';
import { useToast } from '../../../components/Toast';
import { hapticTap } from '../../../utils/haptics';
import { fetchBot, updateBot, CATEGORIES } from '../../../botsApi';
import { uploadLocalImageIfNeeded } from '../../../utils/imageUpload';

function hashColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}

async function pickAvatarImage() {
  const ImagePicker = await import('expo-image-picker');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });
  if (result.canceled) return null;
  return result.assets[0].uri;
}

export default function EditBotScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [description, setDescription] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [category, setCategory] = useState('Other');
  const [categorySheet, setCategorySheet] = useState(false);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [saving, setSaving] = useState(false);
  const [originalImage, setOriginalImage] = useState(null);

  const load = useCallback(async () => {
    try {
      const bot = await fetchBot(id);
      if (!bot) throw new Error('bot_not_found');
      setName(bot.name);
      setUsername(bot.username);
      setDescription(bot.description || '');
      setWelcomeMessage(bot.welcomeMessage || '');
      setProfileImage(bot.profileImage);
      setOriginalImage(bot.profileImage);
      setCategory(bot.category || 'Other');
      setPhase('ready');
    } catch (e) {
      setPhase('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setPhase('loading');
    await load();
  }

  async function handlePickImage() {
    hapticTap();
    const uri = await pickAvatarImage();
    if (uri) setProfileImage(uri);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Only touch profileImage if the user actually changed it, and
      // upload it to persistent storage first — the picker only ever
      // gives back a device-local file:// URI (see utils/imageUpload.js).
      let profileImageUrl;
      if (profileImage !== originalImage) {
        profileImageUrl = await uploadLocalImageIfNeeded(profileImage);
        if (profileImage && !profileImageUrl) {
          toast.error("Couldn't upload photo — saving the rest of your changes.");
        }
      }

      await updateBot(id, {
        name: name.trim(),
        description: description.trim(),
        welcomeMessage: welcomeMessage.trim(),
        category,
        ...(profileImageUrl !== undefined ? { profileImage: profileImageUrl } : {}),
      });
      toast.success('Bot updated');
      router.back();
    } catch (e) {
      toast.error(e.message || "Couldn't save changes");
    } finally {
      setSaving(false);
    }
  }

  const categoryActions = CATEGORIES.map((c) => ({
    key: c,
    label: c,
    icon: c === category ? 'checkmark' : 'ellipse-outline',
    onPress: () => setCategory(c),
  }));

  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={{ padding: space.lg }}>
          <View style={styles.avatarPickWrap}>
            <SkeletonCircle size={76} />
            <SkeletonBox width={90} height={12} style={{ marginTop: space.xs }} />
          </View>
          <SkeletonBox width="100%" height={56} radius={radius.md} style={{ marginBottom: space.md }} />
          <SkeletonBox width="100%" height={56} radius={radius.md} style={{ marginBottom: space.md }} />
          <SkeletonBox width="100%" height={56} radius={radius.md} style={{ marginBottom: space.md }} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        <ErrorState message="Couldn't load this bot's details." onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <View style={styles.avatarPickWrap}>
          <Pressable onPress={handlePickImage} style={({ pressed }) => [styles.avatarPick, pressed && { opacity: 0.8 }]}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.avatarPickImg} />
            ) : (
              <View style={[styles.avatarPickPlaceholder, { backgroundColor: hashColor(name) }]}>
                <Ionicons name="camera-outline" size={24} color="#F2F4F6" />
              </View>
            )}
          </Pressable>
          <Pressable onPress={handlePickImage} hitSlop={8}>
            <Text style={styles.avatarPickLabel}>Change photo</Text>
          </Pressable>
        </View>

        <Field label="Bot name" value={name} onChangeText={setName} placeholder="Support Router" autoCapitalize="words" />
        <Field label="Username" value={`@${username}`} editable={false} helper="Usernames can't be changed after a bot is created." />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="What does this bot do?" />
        <Field label="Welcome message" value={welcomeMessage} onChangeText={setWelcomeMessage} placeholder="Sent on first contact" />

        <Text style={styles.label}>Category</Text>
        <Pressable style={styles.categoryRow} onPress={() => { hapticTap(); setCategorySheet(true); }}>
          <Text style={styles.categoryValue}>{category}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>

        <PrimaryButton label={saving ? 'Saving…' : 'Save changes'} disabled={saving} loading={saving} onPress={handleSave} />
      </ScrollView>

      <ActionSheet visible={categorySheet} onClose={() => setCategorySheet(false)} title="Category" actions={categoryActions} />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    avatarPickWrap: { alignItems: 'center', marginBottom: space.lg, gap: space.sm },
    avatarPick: { width: 76, height: 76, borderRadius: 38, overflow: 'hidden' },
    avatarPickImg: { width: 76, height: 76, borderRadius: 38 },
    avatarPickPlaceholder: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
    avatarPickLabel: { ...type.small, color: colors.accent, fontWeight: '600' },
    label: { ...type.small, color: colors.textSecondary, marginBottom: space.xs, fontWeight: '600' },
    categoryRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
      marginBottom: space.lg,
    },
    categoryValue: { ...type.body, color: colors.textPrimary, fontWeight: '500' },
  });
}
