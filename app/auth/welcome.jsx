import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type, space } from '../../theme';
import { useAccounts } from '../../accountsStore';
import AuthBackground from '../../components/AuthBackground';
import AnimatedLogo from '../../components/AnimatedLogo';
import { PrimaryButton, IconGhostButton } from '../../components/Button';
import StatusTicker from '../../components/StatusTicker';

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addingAccount } = useAccounts();
  const rise = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;



  return (
    <View style={styles.screen}>
      <AuthBackground />

      {addingAccount ? (
        <View style={[styles.closeRow, { top: insets.top + space.sm }]}>
          <IconGhostButton icon="close" onPress={() => router.back()} />
        </View>
      ) : null}

      <View style={styles.center}>
        <AnimatedLogo />

        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }], width: '100%', maxWidth: 520, alignSelf: 'center' }}>
          <Text style={styles.title}>Botmanager</Text>
          <Text style={styles.subtitle}>
            {addingAccount ? 'Sign in with another registered account' : 'Sign in to monitor and run your bots'}
          </Text>

          <View style={styles.actions}>
            <PrimaryButton label="Sign in" onPress={() => router.push('/auth/login')} />
          </View>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <StatusTicker state="idle" label="Ready" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  closeRow: { position: 'absolute', left: space.lg, zIndex: 1 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  title: { ...type.display, color: colors.textPrimary, textAlign: 'center', marginTop: space.lg },
  subtitle: { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: space.xs, marginBottom: space.xl },
  actions: {},
  footer: { paddingBottom: space.xl, paddingTop: space.md },
});
