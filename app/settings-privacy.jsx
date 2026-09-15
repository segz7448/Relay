import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import { usePrivacySecurity } from '../privacySecurity';
import { fetchBlockedUsers, fetchSessions, fetchDevices, fetchLoginActivity } from '../privacyApi';
import { fetchApiKeys } from '../devPlatformStore';

export default function PrivacySecurityScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { state, loaded } = usePrivacySecurity();
  const [counts, setCounts] = useState({ blocked: 0, sessions: 0, devices: 0, failedLogins: 0, apiKeys: 0 });
  const [countsLoading, setCountsLoading] = useState(true);

  const load = useCallback(() => {
    setCountsLoading(true);
    Promise.all([
      fetchBlockedUsers().then((list) => setCounts((c) => ({ ...c, blocked: list.length }))),
      fetchSessions().then((list) => setCounts((c) => ({ ...c, sessions: list.length }))),
      fetchDevices().then((list) => setCounts((c) => ({ ...c, devices: list.length }))),
      fetchLoginActivity().then((list) =>
        setCounts((c) => ({ ...c, failedLogins: list.filter((l) => l.status === 'failed').length }))
      ),
      fetchApiKeys().then((list) => setCounts((c) => ({ ...c, apiKeys: list.length }))),
    ]).finally(() => setCountsLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const alertsOnCount = Object.values(state.alerts).filter(Boolean).length;
  const alertsTotal = Object.keys(state.alerts).length;
  const alertsSummary = alertsOnCount === alertsTotal ? 'On' : alertsOnCount === 0 ? 'Off' : `${alertsOnCount}/${alertsTotal}`;
  const loginActivitySummary = counts.failedLogins > 0 ? `${counts.failedLogins} failed` : 'All clear';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection footer="You'll get a notification if a new device logs into your account.">
        <SettingsRow
          icon="person-remove"
          iconColor="#8E8E93"
          label="Blocked Users"
          value={counts.blocked ? String(counts.blocked) : 'None'}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-blocked-users')}
        />
      </SettingsSection>

      <SettingsSection title="Security">
        <SettingsRow
          icon="key"
          iconColor="#34C759"
          label="Two-Step Verification"
          value={state.twoStep.enabled ? 'On' : 'Off'}
          valueLoading={!loaded}
          onPress={() => router.push('/settings-two-step')}
        />
        <SettingsRow
          icon="keypad"
          iconColor="#5856D6"
          label="Passcode Lock"
          value={state.passcode.enabled ? (state.passcode.biometric ? 'On + Biometric' : 'On') : 'Off'}
          valueLoading={!loaded}
          onPress={() => router.push('/settings-passcode')}
        />
        <SettingsRow
          icon="phone-portrait"
          iconColor="#007AFF"
          label="Active Sessions"
          value={String(counts.sessions)}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-active-sessions')}
        />
        <SettingsRow
          icon="hardware-chip"
          iconColor="#FF9500"
          label="Devices"
          value={String(counts.devices)}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-devices')}
        />
        <SettingsRow
          icon="list"
          iconColor="#00C7BE"
          label="Login Activity"
          value={loginActivitySummary}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-login-activity')}
        />
      </SettingsSection>

      <SettingsSection
        title="Privacy"
        footer="Control who can see your personal info and content across botmanager."
      >
        <SettingsRow
          icon="eye-off"
          iconColor="#FF3B30"
          label="Privacy"
          value="Phone, Last Seen, Photo..."
          onPress={() => router.push('/settings-privacy-rules')}
        />
      </SettingsSection>

      <SettingsSection title="Developer" footer="Manage API keys, bot tokens, and webhooks used to control your bots programmatically.">
        <SettingsRow
          icon="code-slash"
          iconColor="#5856D6"
          label="Developer"
          value={counts.apiKeys ? `${counts.apiKeys} key${counts.apiKeys === 1 ? '' : 's'}` : 'Set up'}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-developer')}
        />
        <SettingsRow
          icon="warning"
          iconColor="#FF2D55"
          label="Security Alerts"
          value={alertsSummary}
          valueLoading={!loaded}
          onPress={() => router.push('/settings-security-alerts')}
        />
      </SettingsSection>
    </ScrollView>
  );
}
