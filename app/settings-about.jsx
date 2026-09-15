import { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { space, useTheme } from '../theme';
import AnimatedLogo from '../components/AnimatedLogo';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import TermsModal from '../components/TermsModal';
import { APP_NAME, APP_VERSION, BUILD_NUMBER, ABOUT_BODY, TERMS_BODY, PRIVACY_BODY } from '../legalCopy';

export default function AboutScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [modal, setModal] = useState(null); // 'terms' | 'privacy' | null

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <View style={styles.hero}>
        <AnimatedLogo size={48} icon="hardware-chip" />
        <Text style={styles.name}>{APP_NAME}</Text>
        <Text style={styles.version}>
          Version {APP_VERSION} ({BUILD_NUMBER})
        </Text>
      </View>

      <Text style={styles.body}>{ABOUT_BODY}</Text>

      <SettingsSection title="More">
        <SettingsRow icon="document-text" iconColor="#5856D6" label="Terms of Service" onPress={() => setModal('terms')} />
        <SettingsRow icon="shield-checkmark" iconColor="#34C759" label="Privacy Policy" onPress={() => setModal('privacy')} />
        <SettingsRow icon="layers" iconColor="#8E8E93" label="Licenses" onPress={() => router.push('/settings-licenses')} />
        <SettingsRow icon="help-circle" iconColor="#FF8A3D" label="Help" onPress={() => router.push('/settings-help')} />
      </SettingsSection>

      <TermsModal visible={modal === 'terms'} onClose={() => setModal(null)} title="Terms of Service" body={TERMS_BODY} />
      <TermsModal visible={modal === 'privacy'} onClose={() => setModal(null)} title="Privacy Policy" body={PRIVACY_BODY} />
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    hero: { alignItems: 'center', paddingVertical: space.lg },
    name: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginTop: space.md },
    version: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    body: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: space.lg },
  });
}
