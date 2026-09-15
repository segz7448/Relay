import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, Linking, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import { SUPPORT_EMAIL } from '../legalCopy';
import { hapticTap } from '../utils/haptics';
import { useToast } from '../components/Toast';
import { durations } from '../utils/motion';

const FAQ = [
  {
    q: 'What is the account API key for?',
    a: 'It authenticates an agent or script so it can create and manage bots on your account — keep it secret, the same way you would a password.',
  },
  {
    q: 'What is a bot token?',
    a: 'Each bot gets its own token when you create it. Attach it to your bot\u2019s configuration to let that specific bot send and receive messages.',
  },
  {
    q: 'How many messages can my bots send?',
    a: 'Botmanager is built for high-throughput messaging — thousands of messages per second per account. Check Settings > Developer for your current rate limits.',
  },
  {
    q: 'How do I add another account?',
    a: 'From Settings, tap Add Account under your profile. You can have up to 3 accounts signed in on one device, and switch between them from the same screen.',
  },
  {
    q: 'What does "Log out all devices" do?',
    a: 'It ends every active session for your account everywhere it\u2019s signed in, including this device, and signs you out. You\u2019ll need to sign back in afterward.',
  },
];

function FaqItem({ item, expanded, onToggle }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getItemStyles(colors), [colors]);
  const anim = useRef(new Animated.Value(0)).current;
  const [measuredHeight, setMeasuredHeight] = useState(0);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: expanded ? 1 : 0,
      duration: durations.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded]);

  const animatedHeight = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(measuredHeight, 1)] });
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Pressable onPress={() => { hapticTap(); onToggle(); }} style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.question}>{item.q}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Animated.View>
      </View>
      <Animated.View style={{ height: animatedHeight, opacity: anim, overflow: 'hidden' }}>
        <Text
          style={styles.answer}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && Math.round(h) !== Math.round(measuredHeight)) setMeasuredHeight(h);
          }}
        >
          {item.a}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function HelpScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [openIndex, setOpenIndex] = useState(null);
  const toast = useToast();

  async function handleContactSupport() {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Botmanager support')}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('no mail client');
      await Linking.openURL(url);
    } catch {
      // No usable mail client — copy the address instead, which works
      // on every platform (Alert.alert is a silent no-op on web).
      await Clipboard.setStringAsync(SUPPORT_EMAIL);
      toast.info(`Support email copied: ${SUPPORT_EMAIL}`);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <Text style={styles.sectionLabel}>Frequently asked</Text>
      <View style={styles.card}>
        {FAQ.map((item, i) => (
          <View key={item.q} style={i > 0 ? styles.separator : null}>
            <FaqItem item={item} expanded={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
          </View>
        ))}
      </View>

      <SettingsSection footer={`Can't find an answer? We usually reply within a day at ${SUPPORT_EMAIL}.`}>
        <SettingsRow icon="mail" iconColor="#FF8A3D" label="Contact Support" onPress={handleContactSupport} />
      </SettingsSection>
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginBottom: space.sm, marginLeft: 2,
    },
    card: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 8, paddingHorizontal: space.md, overflow: 'hidden', marginBottom: space.lg,
    },
    separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  });
}

function getItemStyles(colors) {
  return StyleSheet.create({
    row: { paddingVertical: space.sm },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
    question: { ...type.body, color: colors.textPrimary, flex: 1, marginRight: space.sm, fontWeight: '500' },
    answer: { ...type.small, color: colors.textSecondary, lineHeight: 19, marginTop: space.xs, paddingBottom: space.xs },
  });
}
