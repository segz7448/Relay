import { useCallback, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import { useToast } from '../components/Toast';
import { fetchApiKeys, fetchWebhooks, fetchDevSettings, updateDevSettings } from '../devPlatformStore';
import { fetchBots } from '../botsApi';

export default function DeveloperSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const [counts, setCounts] = useState({ keys: 0, bots: 0, webhooksOn: 0, webhooksTotal: 0 });
  const [countsLoading, setCountsLoading] = useState(true);
  const [devSettings, setDevSettings] = useState(null);

  const load = useCallback(() => {
    setCountsLoading(true);
    Promise.all([
      fetchApiKeys().then((list) => setCounts((c) => ({ ...c, keys: list.length }))),
      fetchBots().then((list) => setCounts((c) => ({ ...c, bots: list.length }))),
      fetchWebhooks().then((list) =>
        setCounts((c) => ({ ...c, webhooksTotal: list.length, webhooksOn: list.filter((w) => w.enabled).length }))
      ),
      fetchDevSettings().then(setDevSettings),
    ]).finally(() => setCountsLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function patch(key, value) {
    const prevValue = devSettings?.[key];
    setDevSettings((prev) => ({ ...prev, [key]: value }));
    updateDevSettings({ [key]: value }).catch(() => {
      setDevSettings((prev) => ({ ...prev, [key]: prevValue }));
      toast.error("Couldn't save that setting");
    });
  }

  const allowlistCount = devSettings?.ipAllowlist?.length ?? 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection
        title="API Access"
        footer="Keys and tokens let scripts, agents, and external services act on this account programmatically."
      >
        <SettingsRow
          icon="key"
          iconColor="#FF8A3D"
          label="API Keys"
          value={String(counts.keys)}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-api-keys')}
        />
        <SettingsRow
          icon="hardware-chip"
          iconColor="#5856D6"
          label="Bot Tokens"
          value={String(counts.bots)}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-bot-tokens')}
        />
        <SettingsRow
          icon="git-network"
          iconColor="#34C759"
          label="Webhooks"
          value={counts.webhooksTotal ? `${counts.webhooksOn}/${counts.webhooksTotal} active` : 'None'}
          valueLoading={countsLoading}
          onPress={() => router.push('/settings-webhooks')}
        />
      </SettingsSection>

      <SettingsSection title="Resources">
        <SettingsRow
          icon="book"
          iconColor="#007AFF"
          label="API Documentation"
          onPress={() => router.push('/settings-api-docs')}
        />
      </SettingsSection>

      {devSettings ? (
        <>
          <SettingsSection
            title="Developer Settings"
            footer="Signed requests and IP restrictions apply to every API key on this account."
          >
            <SettingsRow
              icon="shield-checkmark"
              iconColor="#34C759"
              label="Require Signed Requests"
              toggle={{ value: devSettings.requireSigning, onValueChange: (v) => patch('requireSigning', v) }}
            />
            <SettingsRow
              icon="globe-outline"
              iconColor="#5856D6"
              label="IP Allowlist"
              value={allowlistCount ? `${allowlistCount} address${allowlistCount === 1 ? '' : 'es'}` : 'Any'}
              onPress={() => router.push('/settings-ip-allowlist')}
            />
            <SettingsRow
              icon="flask"
              iconColor="#FF9500"
              label="Sandbox Mode"
              toggle={{ value: devSettings.sandboxMode, onValueChange: (v) => patch('sandboxMode', v) }}
            />
            <SettingsRow
              icon="terminal"
              iconColor="#8E8E93"
              label="Verbose Request Logging"
              toggle={{ value: devSettings.verboseLogging, onValueChange: (v) => patch('verboseLogging', v) }}
            />
            <SettingsRow
              icon="sparkles"
              iconColor="#00C7BE"
              label="Early Access API Features"
              toggle={{ value: devSettings.betaAccess, onValueChange: (v) => patch('betaAccess', v) }}
            />
          </SettingsSection>
        </>
      ) : null}
    </ScrollView>
  );
}
