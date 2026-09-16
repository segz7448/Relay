import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';

// Generated from package.json's runtime dependency list.
const LIBRARIES = [
  { name: '@config-plugins/react-native-webrtc', version: '^10.0.0' },
  { name: '@expo/metro-runtime', version: '~4.0.1' },
  { name: '@expo/vector-icons', version: '14.0.4' },
  { name: '@react-native-community/netinfo', version: '11.4.1' },
  { name: 'expo', version: '^52.0.0' },
  { name: 'expo-asset', version: '~11.0.5' },
  { name: 'expo-av', version: '~15.0.1' },
  { name: 'expo-blur', version: '~14.0.1' },
  { name: 'expo-clipboard', version: '~7.0.0' },
  { name: 'expo-constants', version: '~17.0.0' },
  { name: 'expo-contacts', version: '~14.0.1' },
  { name: 'expo-dev-client', version: '5.0.20' },
  { name: 'expo-device', version: '~7.0.0' },
  { name: 'expo-document-picker', version: '~13.0.1' },
  { name: 'expo-font', version: '13.0.4' },
  { name: 'expo-haptics', version: '~14.0.0' },
  { name: 'expo-image-picker', version: '~16.0.1' },
  { name: 'expo-local-authentication', version: '~15.0.1' },
  { name: 'expo-location', version: '~18.0.1' },
  { name: 'expo-notifications', version: '~0.29.0' },
  { name: 'expo-router', version: '^4.0.0' },
  { name: 'expo-screen-orientation', version: '~8.0.4' },
  { name: 'expo-secure-store', version: '~14.0.0' },
  { name: 'expo-status-bar', version: '~2.0.0' },
  { name: 'react', version: '18.3.1' },
  { name: 'react-dom', version: '18.3.1' },
  { name: 'react-native', version: '0.76.9' },
  { name: 'react-native-incall-manager', version: '^4.3.0' },
  { name: 'react-native-safe-area-context', version: '4.12.0' },
  { name: 'react-native-screens', version: '4.4.0' },
  { name: 'react-native-svg', version: '15.8.0' },
  { name: 'react-native-web', version: '~0.19.13' },
  { name: 'react-native-webrtc', version: '^118.0.7' },
];

export default function LicensesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <SettingsSection footer="Relay ships with these open-source packages. License texts remain available in each package distribution.">
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
