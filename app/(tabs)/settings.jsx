import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Linking, StyleSheet } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../../theme';
import { SecondaryButton } from '../../components/Button';
import SettingsSection from '../../components/SettingsSection';
import SettingsRow from '../../components/SettingsRow';
import AccountRow from '../../components/AccountRow';
import Avatar from '../../components/Avatar';
import ActionSheet from '../../components/ActionSheet';
import TermsModal from '../../components/TermsModal';
import { api } from '../../api';
import { useAccounts } from '../../accountsStore';
import { useProfile } from '../../profileStore';
import { useNotificationPrefs } from '../../notificationPrefs';
import { useStatusBurst } from '../../components/StatusBurst';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { hapticSwitch, hapticTap } from '../../utils/haptics';
import { terminateAllSessions } from '../../privacyApi';
import { APP_VERSION, BUILD_NUMBER, SUPPORT_EMAIL, TERMS_BODY, PRIVACY_BODY } from '../../legalCopy';

export default function SettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { profile } = useProfile();
  const { prefs } = useNotificationPrefs();
  const {
    accounts,
    activeId,
    maxAccounts,
    beginAddAccount,
    switchAccount,
    removeAccount,
    updateActiveAccount,
  } = useAccounts();
  const burst = useStatusBurst();
  const confirm = useConfirm();
  const toast = useToast();

  const [account, setAccount] = useState(null);
  const [newKey, setNewKey] = useState(null); // shown once after rotation
  const [error, setError] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [switcherSheet, setSwitcherSheet] = useState(null); // the other account, or null
  const [legalModal, setLegalModal] = useState(null); // 'terms' | 'privacy' | null

  useEffect(() => {
    api.me().then(setAccount).catch((e) => setError(e.message));
  }, [activeId]);

  // "Edit" / "Done" in the nav bar — matches Telegram's own Settings
  // header, which is how you get to the red delete controls on other
  // accounts in the switcher below.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setEditing((v) => !v)} hitSlop={10} style={{ marginRight: space.md }}>
          <Text style={styles.editLabel}>{editing ? 'Done' : 'Edit'}</Text>
        </Pressable>
      ),
    });
  }, [navigation, editing, styles]);

  const otherAccounts = accounts.filter((a) => a.id !== activeId);
  const atAccountLimit = accounts.length >= maxAccounts;

  async function handleSwitchAccount(id) {
    hapticSwitch();
    await switchAccount(id);
  }

  function handleAddAccount() {
    if (atAccountLimit) return;
    hapticTap();
    beginAddAccount();
    router.push('/auth/welcome');
  }

  async function confirmRemoveAccount(acct) {
    const label = acct.name || acct.username || acct.email || 'This account';
    await confirm({
      title: 'Log Out?',
      message: `${label} will be signed out of botmanager on this device.`,
      confirmLabel: 'Log Out',
      destructive: true,
      onConfirm: async () => {
        await removeAccount(acct.id);
      },
    });
  }

  async function handleRotate() {
    setRotating(true);
    try {
      const { apiKey } = await api.rotateApiKey();
      setNewKey(apiKey);
      await updateActiveAccount({ apiKey });
      toast.success('API key regenerated');
    } catch (e) {
      toast.error("Couldn't regenerate your key");
    } finally {
      setRotating(false);
    }
  }

  async function handleSignOut() {
    const activeAccount = accounts.find((a) => a.id === activeId);
    const remaining = accounts.length - 1;
    await confirm({
      title: 'Log Out?',
      message:
        remaining > 0
          ? "You'll be switched to your other account on this device."
          : "You'll need to sign back in to use botmanager again on this device.",
      confirmLabel: 'Log Out',
      destructive: true,
      onConfirm: async () => {
        const { remainingCount } = await removeAccount(activeAccount.id);
        if (remainingCount === 0) router.replace('/auth/welcome');
      },
    });
  }

  async function handleLogoutAllDevices() {
    const ok = await confirm({
      title: 'Log Out All Devices?',
      message: 'This ends every active session for this account everywhere it\u2019s signed in, including this device. You\u2019ll need to sign in again.',
      confirmLabel: 'Log Out All Devices',
      destructive: true,
      onConfirm: async () => {
        try {
          await terminateAllSessions();
        } catch (e) {
          // best-effort — still sign out locally even if the server call fails
        }
        const activeAccount = accounts.find((a) => a.id === activeId);
        const { remainingCount } = await removeAccount(activeAccount.id);
        if (remainingCount === 0) router.replace('/auth/welcome');
      },
    });
    if (ok) burst.success('Logged out of all devices');
  }

  async function handleContactSupport() {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Botmanager support')}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('no mail client');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Contact Support', `Reach us at ${SUPPORT_EMAIL}`);
    }
  }

  const onCount = [
    prefs.messageNotifications,
    prefs.botNotifications,
    prefs.serverNotifications,
    prefs.callNotifications,
  ].filter(Boolean).length;
  const notifSummary = onCount === 4 ? 'On' : onCount === 0 ? 'Off' : `${onCount}/4`;

  const displayName = profile.name || 'Add your name';
  const displaySub = profile.username
    ? `@${profile.username}`
    : profile.email || account?.email || 'Tap to set up your profile';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 4 }}>
      <SettingsSection footer={atAccountLimit ? `You can have up to ${maxAccounts} accounts on this device.` : undefined}>
        <Pressable
          onPress={() => router.push('/contact/me')}
          style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.profileAvatarWrap}>
            <Avatar uri={profile.photo} name={profile.name || profile.username || account?.email} size={58} />
            {otherAccounts.length > 0 ? <View style={styles.profileOnlineDot} /> : null}
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.profileSub} numberOfLines={1}>
              {displaySub}
            </Text>
            {profile.bio ? (
              <Text style={styles.profileBio} numberOfLines={1}>
                {profile.bio}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        {otherAccounts.map((acct) => (
          <AccountRow
            key={acct.id}
            account={acct}
            editing={editing}
            onPress={() => handleSwitchAccount(acct.id)}
            onLongPress={() => setSwitcherSheet(acct)}
            onRemove={() => confirmRemoveAccount(acct)}
          />
        ))}

        {!atAccountLimit ? (
          <SettingsRow
            icon="add"
            iconColor={colors.accent}
            label="Add Account"
            onPress={handleAddAccount}
            chevron={false}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          icon="notifications"
          iconColor="#FF3B30"
          label="Notifications and Sounds"
          value={notifSummary}
          onPress={() => router.push('/settings-notifications')}
        />
        <SettingsRow
          icon="lock-closed"
          iconColor="#5856D6"
          label="Privacy and Security"
          onPress={() => router.push('/settings-privacy')}
        />
        <SettingsRow
          icon="color-palette"
          iconColor="#FF8A3D"
          label="Appearance"
          onPress={() => router.push('/settings-appearance')}
        />
      </SettingsSection>

      <Text style={styles.sectionLabel}>API key</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.helper}>
        Use this key to let an agent or script create and manage bots on your account programmatically.
      </Text>
      <View style={styles.keyBox}>
        <Text style={styles.keyText}>{newKey ?? `${account?.apiKeyPrefix ?? 'sk_live_'}••••••••`}</Text>
      </View>
      {newKey ? <Text style={styles.helper}>This is shown once — copy it now.</Text> : null}
      <SecondaryButton label="Regenerate key" onPress={handleRotate} loading={rotating} />

      <SettingsSection title="About">
        <SettingsRow icon="information-circle" iconColor="#8E8E93" label="About" onPress={() => router.push('/settings-about')} />
        <SettingsRow icon="phone-portrait" iconColor="#8E8E93" label="Version" value={`${APP_VERSION} (${BUILD_NUMBER})`} chevron={false} />
        <SettingsRow icon="document-text" iconColor="#5856D6" label="Terms of Service" onPress={() => setLegalModal('terms')} />
        <SettingsRow icon="shield-checkmark" iconColor="#34C759" label="Privacy Policy" onPress={() => setLegalModal('privacy')} />
        <SettingsRow icon="layers" iconColor="#8E8E93" label="Licenses" onPress={() => router.push('/settings-licenses')} />
        <SettingsRow icon="help-circle" iconColor="#FF8A3D" label="Help" onPress={() => router.push('/settings-help')} />
        <SettingsRow icon="mail" iconColor="#FF3B30" label="Contact Support" onPress={handleContactSupport} />
      </SettingsSection>

      <View style={{ marginTop: space.lg }}>
        <SettingsSection
          title="Logout"
          footer={
            otherAccounts.length > 0
              ? "You'll be switched to your other account on this device."
              : "You'll need to sign back in to use botmanager again on this device."
          }
        >
          <SettingsRow label="Log out" destructive center onPress={handleSignOut} />
          <SettingsRow label="Log out all devices" destructive center onPress={handleLogoutAllDevices} />
        </SettingsSection>
      </View>

      <TermsModal visible={legalModal === 'terms'} onClose={() => setLegalModal(null)} title="Terms of Service" body={TERMS_BODY} />
      <TermsModal visible={legalModal === 'privacy'} onClose={() => setLegalModal(null)} title="Privacy Policy" body={PRIVACY_BODY} />

      <ActionSheet
        visible={!!switcherSheet}
        onClose={() => setSwitcherSheet(null)}
        title={switcherSheet?.name || switcherSheet?.username || switcherSheet?.email}
        actions={
          switcherSheet
            ? [
                {
                  key: 'switch',
                  label: 'Switch to This Account',
                  icon: 'swap-horizontal',
                  onPress: () => handleSwitchAccount(switcherSheet.id),
                },
                {
                  key: 'logout',
                  label: 'Log Out',
                  icon: 'log-out-outline',
                  destructive: true,
                  onPress: () => confirmRemoveAccount(switcherSheet),
                },
              ]
            : []
        }
      />
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      ...type.small,
      color: colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: space.lg,
      marginBottom: space.sm,
    },
    helper: { ...type.body, color: colors.textSecondary, marginBottom: space.md },
    error: { ...type.small, color: colors.danger, marginBottom: space.md },
    profileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs },
    profileAvatarWrap: { position: 'relative' },
    profileOnlineDot: {
      position: 'absolute', right: 1, bottom: 1,
      width: 15, height: 15, borderRadius: 8,
      backgroundColor: colors.online, borderWidth: 2, borderColor: colors.bg,
    },
    profileText: { flex: 1, marginLeft: space.md, marginRight: space.sm },
    profileName: { ...type.h1, fontWeight: '700', color: colors.textPrimary },
    profileSub: { ...type.body, color: colors.textSecondary, marginTop: 2 },
    profileBio: { ...type.small, color: colors.textMuted, marginTop: 2 },
    editLabel: { ...type.body, color: colors.accent, fontWeight: '600' },
    keyBox: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
      marginBottom: space.md,
    },
    keyText: { ...type.dataLg, fontSize: 15, color: colors.accent },
  });
}
