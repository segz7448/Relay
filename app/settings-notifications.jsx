import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import ActionSheet from '../components/ActionSheet';
import { useNotificationPrefs, SOUND_OPTIONS } from '../notificationPrefs';
import { useNotifications } from '../notifications';

export default function NotificationsSettingsScreen() {
  const { colors } = useTheme();
  const { prefs, setPref } = useNotificationPrefs();
  const { unreadCount } = useNotifications();
  const router = useRouter();
  const [soundSheet, setSoundSheet] = useState(false);

  // Sound/vibration/previews only matter if at least one category of
  // alert is actually turned on — greyed out otherwise, Telegram-style.
  const anyAlertsOn =
    prefs.messageNotifications || prefs.botNotifications || prefs.serverNotifications || prefs.callNotifications;

  const soundActions = SOUND_OPTIONS.map((s) => ({
    key: s,
    label: s,
    icon: s === prefs.sound ? 'checkmark-circle' : 'ellipse-outline',
    onPress: () => setPref('sound', s),
  }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
        <SettingsSection>
          <SettingsRow
            icon="notifications"
            iconColor="#E5883D"
            label="In-app inbox"
            value={unreadCount ? `${unreadCount} unread` : 'All caught up'}
            onPress={() => router.push('/notifications')}
            chevron
          />
        </SettingsSection>

        <SettingsSection
          title="Notifications"
          footer="Turn off a category to stop getting alerts for it — you'll still see it inside the app."
        >
          <SettingsRow
            icon="chatbubble-ellipses"
            iconColor="#34C759"
            label="Message notifications"
            toggle={{ value: prefs.messageNotifications, onValueChange: (v) => setPref('messageNotifications', v) }}
          />
          <SettingsRow
            icon="hardware-chip-outline"
            iconColor="#5856D6"
            label="Bot notifications"
            toggle={{ value: prefs.botNotifications, onValueChange: (v) => setPref('botNotifications', v) }}
          />
          <SettingsRow
            icon="server-outline"
            iconColor="#FF9500"
            label="Server notifications"
            toggle={{ value: prefs.serverNotifications, onValueChange: (v) => setPref('serverNotifications', v) }}
          />
          <SettingsRow
            icon="call"
            iconColor="#FF3B30"
            label="Call notifications"
            toggle={{ value: prefs.callNotifications, onValueChange: (v) => setPref('callNotifications', v) }}
          />
        </SettingsSection>

        <SettingsSection title="Sound" footer="Choose the alert sound and whether this device vibrates for it.">
          <SettingsRow
            icon="musical-notes"
            iconColor="#007AFF"
            label="Sound"
            value={prefs.sound}
            onPress={() => setSoundSheet(true)}
            disabled={!anyAlertsOn}
          />
          <SettingsRow
            icon="phone-portrait-outline"
            iconColor="#8E8E93"
            label="Vibration"
            toggle={{ value: prefs.vibration, onValueChange: (v) => setPref('vibration', v) }}
            disabled={!anyAlertsOn}
          />
        </SettingsSection>

        <SettingsSection
          title="In-App Notifications"
          footer="These control alerts and badges while you're actively using botmanager on this device."
        >
          <SettingsRow
            icon="apps"
            iconColor="#00C7BE"
            label="In-app notifications"
            toggle={{ value: prefs.inAppNotifications, onValueChange: (v) => setPref('inAppNotifications', v) }}
          />
          <SettingsRow
            icon="eye"
            iconColor="#5AC8FA"
            label="Preview messages"
            toggle={{ value: prefs.previewMessages, onValueChange: (v) => setPref('previewMessages', v) }}
            disabled={!anyAlertsOn}
          />
          <SettingsRow
            icon="notifications-circle"
            iconColor="#FF2D55"
            label="Notification badge"
            toggle={{ value: prefs.notificationBadge, onValueChange: (v) => setPref('notificationBadge', v) }}
          />
        </SettingsSection>
      </ScrollView>

      <ActionSheet visible={soundSheet} onClose={() => setSoundSheet(false)} title="Notification Sound" actions={soundActions} />
    </View>
  );
}
