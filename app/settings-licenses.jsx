import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';

// Mirrors package.json's dependency list. Every package here ships
// under the MIT license (standard for the Expo/React Native
// ecosystem) — update this list if a dependency with a different
// license is ever added.
const LIBRARIES = [
  { name: 'expo', version: '^52.0.0' },
  { name: 'expo-router', version: '^4.0.0' },
  { name: 'expo-status-bar', version: '~2.0.0' },
  { name: 'expo-secure-store', version: '~14.0.0' },
  { name: 'expo-notifications', version: '~0.29.0' },
  { name: 'expo-device', version: '~7.0.0' },
  { name: 'expo-constants', version: '~17.0.0' },
  { name: 'expo-av', version: '~15.0.1' },
  { name: 'expo-blur', version: '~14.0.1' },
  { name: 'expo-clipboard', version: '~7.0.0' },
  { name: 'expo-document-picker', version: '~13.0.1' },
  { name: 'expo-image-picker', version: '~16.0.1' },
  { name: 'expo-location', version: '~18.0.1' },
  { name: 'expo-haptics', version: '~14.0.0' },
  { name: 'expo-local-authentication', version: '~15.0.1' },
  { name: 'react-native-svg', version: '15.8.0' },
  { name: '@expo/vector-icons', version: '^14.0.0' },
  { name: 'react', version: '18.3.1' },
  { name: 'react-native', version: '0.76.0' },
];

export default function LicensesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection footer="Botmanager is built with these open-source packages, each under the MIT license.">
        {LIBRARIES.map((lib) => (
          <SettingsRow key={lib.name} label={lib.name} value={lib.version} chevron={false} />
        ))}
      </SettingsSection>
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
  });
}
