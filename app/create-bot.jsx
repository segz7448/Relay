import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';
import Field from '../components/Field';
import Checkbox from '../components/Checkbox';
import { PrimaryButton, SecondaryButton } from '../components/Button';
import AnimatedLogo from '../components/AnimatedLogo';
import ActionSheet from '../components/ActionSheet';
import { createBot, CATEGORIES } from '../botsApi';
import { uploadLocalImageIfNeeded } from '../utils/imageUpload';

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

export default function CreateBotScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [description, setDescription] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [category, setCategory] = useState('Other');
  const [categorySheet, setCategorySheet] = useState(false);

  const [enableBot, setEnableBot] = useState(true);
  const [allowMessages, setAllowMessages] = useState(true);
  const [allowFiles, setAllowFiles] = useState(true);
  const [allowCommands, setAllowCommands] = useState(true);
  const [enableNotifications, setEnableNotifications] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { bot, token }
  const [copied, setCopied] = useState(false);

  const usernameClean = username.trim().replace(/^@/, '');
  const usernameValid = /^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(usernameClean);
  const canCreate = name.trim().length > 0 && usernameValid && !submitting;

  async function handleCreate() {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      // Picker only ever returns a device-local file:// URI — upload it to
      // persistent storage first so the bot record stores a real URL
      // (see utils/imageUpload.js). `profileImage` state itself is left
      // alone so the local preview on this screen keeps working even if
      // the upload fails.
      const uploadedImageUrl = await uploadLocalImageIfNeeded(profileImage);
      const { bot, token } = await createBot({
        name, username: usernameClean, description, welcomeMessage,
        profileImage: uploadedImageUrl, category, enableBot, allowMessages, allowFiles,
        allowCommands, enableNotifications, avatarColor: hashColor(name || usernameClean),
      });
      setResult({ bot, token });
    } catch (e) {
      setError(e.message || 'Something went wrong creating this bot.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyToken() {
    if (!result) return;
    await Clipboard.setStringAsync(result.token);
    setCopied(true);
  }

  async function handlePickImage() {
    const uri = await pickAvatarImage();
    if (uri) setProfileImage(uri);
  }

  const categoryActions = CATEGORIES.map((c) => ({
    key: c,
    label: c,
    icon: c === category ? 'checkmark' : 'ellipse-outline',
    onPress: () => setCategory(c),
  }));

  // --- Success screen ---------------------------------------------------
  if (result) {
    const avatarColor = hashColor(result.bot.name);
    const initials = result.bot.name.trim().slice(0, 1).toUpperCase();
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.successBody}>
          <AnimatedLogo size={56} icon="checkmark" />
          <Text style={styles.successTitle}>Bot created</Text>
          <Text style={styles.successSubtitle}>
            {result.bot.name} is live and already showing up in Messages.
          </Text>

          <View style={styles.successCard}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.successAvatarImg} />
            ) : (
              <View style={[styles.successAvatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.successAvatarText}>{initials}</Text>
              </View>
            )}
            <Text style={styles.successName}>{result.bot.name}</Text>
            <Text style={styles.successUsername}>@{result.bot.username}</Text>
          </View>

          <View style={styles.warningBox}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={styles.warningText}>
              This token is shown once. Copy it now and store it somewhere safe — you'll only see
              the first few characters after you leave this screen.
            </Text>
          </View>

          <View style={styles.tokenBox}>
            <Text style={styles.tokenText} numberOfLines={2}>{result.token}</Text>
          </View>

          <SecondaryButton
            label={copied ? 'Copied' : 'Copy token'}
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={handleCopyToken}
          />
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/')} />
        </View>
      </View>
    );
  }

  // --- Create form --------------------------------------------------------
  return (
    <View style={styles.screen}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
        <View style={styles.avatarPickWrap}>
          <Pressable onPress={handlePickImage} style={styles.avatarPick}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.avatarPickImg} />
            ) : (
              <View style={[styles.avatarPickPlaceholder, { backgroundColor: hashColor(name || 'new bot') }]}>
                <Ionicons name="camera-outline" size={26} color="#F2F4F6" />
              </View>
            )}
          </Pressable>
          <Pressable onPress={handlePickImage} hitSlop={8}>
            <Text style={styles.avatarPickLabel}>{profileImage ? 'Change photo' : 'Set profile photo'}</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Identity</Text>
        <Field label="Bot name" value={name} onChangeText={setName} placeholder="Support Router" autoCapitalize="words" />
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          placeholder="support_router_bot"
          icon="at"
          helper={username && !usernameValid ? 'At least 4 characters, starting with a letter — letters, numbers, underscores only.' : "Must be unique. Usually ends in \"bot\"."}
          error={username && !usernameValid ? ' ' : null}
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What does this bot do?"
          helper="Shown on the bot's profile, before anyone starts a chat."
        />

        <Text style={styles.sectionLabel}>Category</Text>
        <Pressable style={styles.categoryRow} onPress={() => setCategorySheet(true)}>
          <Text style={styles.categoryValue}>{category}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>

        <Text style={styles.sectionLabel}>Welcome message</Text>
        <Field
          value={welcomeMessage}
          onChangeText={setWelcomeMessage}
          placeholder="Hi! I'm here to help — send /start to begin."
          helper="Sent automatically the first time someone opens a chat with this bot."
        />

        <Text style={styles.sectionLabel}>Options</Text>
        <View style={styles.optionsCard}>
          <Checkbox checked={enableBot} onToggle={() => setEnableBot((v) => !v)}>Enable bot</Checkbox>
          <Checkbox checked={allowMessages} onToggle={() => setAllowMessages((v) => !v)}>Allow messages</Checkbox>
          <Checkbox checked={allowFiles} onToggle={() => setAllowFiles((v) => !v)}>Allow files</Checkbox>
          <Checkbox checked={allowCommands} onToggle={() => setAllowCommands((v) => !v)}>Allow commands</Checkbox>
          <Checkbox checked={enableNotifications} onToggle={() => setEnableNotifications((v) => !v)}>Enable notifications</Checkbox>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={submitting ? 'Creating…' : 'Create Bot'} disabled={!canCreate} loading={submitting} onPress={handleCreate} />
      </View>

      <ActionSheet
        visible={categorySheet}
        onClose={() => setCategorySheet(false)}
        title="Category"
        actions={categoryActions}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginBottom: space.md, marginTop: space.md,
    },
    error: { ...type.small, color: colors.danger, marginBottom: space.md },
    footer: {
      padding: space.lg, paddingTop: space.md,
      borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
    },

    avatarPickWrap: { alignItems: 'center', marginBottom: space.md, gap: space.sm },
    avatarPick: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden' },
    avatarPickImg: { width: 88, height: 88, borderRadius: 44 },
    avatarPickPlaceholder: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
    avatarPickLabel: { ...type.small, color: colors.accent, fontWeight: '600' },

    categoryRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
      marginBottom: space.lg,
    },
    categoryValue: { ...type.body, color: colors.textPrimary, fontWeight: '500' },

    optionsCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, paddingBottom: space.xs,
      marginBottom: space.lg,
    },

    successBody: { alignItems: 'center', padding: space.lg, paddingTop: space.xl },
    successTitle: { ...type.display, fontSize: 22, color: colors.textPrimary, marginTop: space.md },
    successSubtitle: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xs, marginBottom: space.lg },
    successCard: {
      alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.lg, paddingVertical: space.lg, paddingHorizontal: space.xl,
      width: '100%', marginBottom: space.lg, gap: 4,
    },
    successAvatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
    successAvatarImg: { width: 72, height: 72, borderRadius: 36, marginBottom: space.sm },
    successAvatarText: { color: '#F2F4F6', fontSize: 26, fontWeight: '600' },
    successName: { ...type.h1, color: colors.textPrimary },
    successUsername: { ...type.dataSm, color: colors.textMuted },
    warningBox: {
      flexDirection: 'row', gap: space.sm, backgroundColor: colors.dangerDim ?? colors.surfaceRaised,
      borderRadius: radius.md, padding: space.md, width: '100%', marginBottom: space.md,
    },
    warningText: { ...type.small, color: colors.textSecondary, flex: 1, lineHeight: 17 },
    tokenBox: {
      width: '100%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md, marginBottom: space.md,
    },
    tokenText: { ...type.dataSm, color: colors.accent },
  });
}
