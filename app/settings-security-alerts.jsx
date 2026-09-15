import { ScrollView } from 'react-native';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import { usePrivacySecurity } from '../privacySecurity';

export default function SecurityAlertsScreen() {
  const { colors } = useTheme();
  const { state, setAlert } = usePrivacySecurity();
  const { alerts } = state;

  const anyChannelOn = alerts.emailAlerts || alerts.pushAlerts;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection
        title="Alert Me When"
        footer="Get notified about activity that could mean someone else is trying to access your account."
      >
        <SettingsRow
          icon="log-in"
          iconColor="#007AFF"
          label="New Login"
          toggle={{ value: alerts.newLogin, onValueChange: (v) => setAlert('newLogin', v) }}
        />
        <SettingsRow
          icon="hardware-chip"
          iconColor="#FF9500"
          label="New Device Added"
          toggle={{ value: alerts.newDevice, onValueChange: (v) => setAlert('newDevice', v) }}
        />
        <SettingsRow
          icon="warning"
          iconColor="#FF3B30"
          label="Repeated Failed Attempts"
          toggle={{ value: alerts.failedAttempts, onValueChange: (v) => setAlert('failedAttempts', v) }}
        />
        <SettingsRow
          icon="code-slash"
          iconColor="#5856D6"
          label="Unusual API Key Usage"
          toggle={{ value: alerts.apiKeyUsage, onValueChange: (v) => setAlert('apiKeyUsage', v) }}
        />
      </SettingsSection>

      <SettingsSection
        title="Notify Me Via"
        footer={!anyChannelOn ? 'At least one channel should stay on so you don\u2019t miss a real alert.' : undefined}
      >
        <SettingsRow
          icon="mail"
          iconColor="#34C759"
          label="Email"
          toggle={{ value: alerts.emailAlerts, onValueChange: (v) => setAlert('emailAlerts', v) }}
        />
        <SettingsRow
          icon="notifications"
          iconColor="#FF2D55"
          label="Push Notification"
          toggle={{ value: alerts.pushAlerts, onValueChange: (v) => setAlert('pushAlerts', v) }}
        />
      </SettingsSection>
    </ScrollView>
  );
}
