import { useState } from 'react';
import { ScrollView } from 'react-native';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import ActionSheet from '../components/ActionSheet';
import { usePrivacySecurity, RULE_OPTIONS, RULE_FIELDS, ruleLabel } from '../privacySecurity';

export default function PrivacyRulesScreen() {
  const { colors } = useTheme();
  const { state, setRule } = usePrivacySecurity();
  const [activeField, setActiveField] = useState(null);

  const activeMeta = RULE_FIELDS.find((f) => f.key === activeField);
  const actions = activeField
    ? RULE_OPTIONS.map((opt) => ({
        key: opt.key,
        label: opt.label,
        icon: state.rules[activeField] === opt.key ? 'checkmark-circle' : opt.icon,
        onPress: () => setRule(activeField, opt.key),
      }))
    : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection
        title="Who can see my..."
        footer="Choose who can see this information. You can restrict it to your contacts or hide it from everyone."
      >
        {RULE_FIELDS.slice(0, 3).map((f) => (
          <SettingsRow
            key={f.key}
            icon={f.icon}
            iconColor={f.iconColor}
            label={f.label}
            value={ruleLabel(state.rules[f.key])}
            onPress={() => setActiveField(f.key)}
          />
        ))}
      </SettingsSection>

      <SettingsSection
        title="Who can contact me..."
        footer="These settings apply to calls, forwarded messages, group invites, and voice messages sent to you."
      >
        {RULE_FIELDS.slice(3).map((f) => (
          <SettingsRow
            key={f.key}
            icon={f.icon}
            iconColor={f.iconColor}
            label={f.label}
            value={ruleLabel(state.rules[f.key])}
            onPress={() => setActiveField(f.key)}
          />
        ))}
      </SettingsSection>

      <ActionSheet
        visible={!!activeField}
        onClose={() => setActiveField(null)}
        title={activeMeta?.label}
        actions={actions}
      />
    </ScrollView>
  );
}
