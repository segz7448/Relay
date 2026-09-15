import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { type, space, radius, useTheme } from '../theme';
import { hapticTap } from '../utils/haptics';

const BASE_URL = 'https://api.botmanager.dev';

const METHOD_COLORS = {
  GET: '#34C759',
  POST: '#FF8A3D',
  PATCH: '#5856D6',
  DELETE: '#FF3B30',
};

const SECTIONS = [
  {
    title: 'Accounts',
    endpoints: [
      { method: 'POST', path: '/accounts', desc: 'Create an account. Returns your API key once — store it immediately.', body: '{ "email": "you@example.com" }' },
      { method: 'GET', path: '/accounts/me', desc: 'Return the authenticated account and its key prefix.' },
      { method: 'POST', path: '/accounts/me/rotate-key', desc: 'Invalidate the current API key and issue a new one.' },
    ],
  },
  {
    title: 'Bots',
    endpoints: [
      { method: 'GET', path: '/bots', desc: 'List every bot on the authenticated account.' },
      { method: 'POST', path: '/bots', desc: 'Register a new bot. Omit existingToken to mint a fresh one.', body: '{ "name": "OrderBot", "username": "orderbot", "webhook": "https://..." }' },
      { method: 'GET', path: '/bots/:id', desc: 'Fetch a single bot by ID.' },
      { method: 'PATCH', path: '/bots/:id', desc: 'Update a bot\u2019s name, webhook URL, or notification setting.' },
      { method: 'POST', path: '/bots/:id/rotate-token', desc: 'Invalidate a bot\u2019s token and issue a new one.' },
      { method: 'DELETE', path: '/bots/:id', desc: 'Permanently remove a bot.' },
    ],
  },
  {
    title: 'Stats',
    endpoints: [
      { method: 'GET', path: '/stats/summary', desc: 'Total throughput across every bot on the account.' },
      { method: 'GET', path: '/stats/bots/:id/rate', desc: 'Current messages-per-second for a single bot.' },
    ],
  },
  {
    title: 'Webhook Delivery',
    endpoints: [
      { method: 'POST', path: '/webhook/:token', desc: 'Public inbound endpoint — the URL you set as a bot\u2019s delivery target. Authenticated by the bot token in the path, not your API key.' },
    ],
  },
];

const CURL_EXAMPLE = `curl ${BASE_URL}/bots \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"OrderBot","username":"orderbot"}'`;

function MethodPill({ method }) {
  const color = METHOD_COLORS[method] || '#8E8E93';
  return (
    <View style={[docStyles.methodPill, { backgroundColor: color }]}>
      <Text style={docStyles.methodPillText}>{method}</Text>
    </View>
  );
}

export default function ApiDocsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const [copiedBase, setCopiedBase] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  async function copyBase() {
    hapticTap();
    await Clipboard.setStringAsync(BASE_URL);
    setCopiedBase(true);
    setTimeout(() => setCopiedBase(false), 1500);
  }
  async function copyCurl() {
    hapticTap();
    await Clipboard.setStringAsync(CURL_EXAMPLE);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 1500);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl * 3 }}>
      <Text style={styles.sectionLabel}>Base URL</Text>
      <Pressable style={styles.codeBox} onPress={copyBase}>
        <Text style={styles.codeText}>{BASE_URL}</Text>
        <Ionicons name={copiedBase ? 'checkmark' : 'copy-outline'} size={16} color={colors.textMuted} />
      </Pressable>

      <Text style={[styles.sectionLabel, { marginTop: space.lg }]}>Authentication</Text>
      <Text style={styles.paragraph}>
        Every request except account creation and webhook delivery requires an API key, sent as a bearer token:
      </Text>
      <View style={styles.codeBoxStatic}>
        <Text style={styles.codeText}>Authorization: Bearer sk_live_••••••••••</Text>
      </View>

      <Text style={[styles.sectionLabel, { marginTop: space.lg }]}>Example Request</Text>
      <Pressable style={styles.codeBlockLarge} onPress={copyCurl}>
        <Text style={styles.codeTextMultiline}>{CURL_EXAMPLE}</Text>
        <View style={styles.copyHint}>
          <Ionicons name={copiedCurl ? 'checkmark' : 'copy-outline'} size={14} color={colors.textMuted} />
          <Text style={styles.copyHintText}>{copiedCurl ? 'Copied' : 'Tap to copy'}</Text>
        </View>
      </Pressable>

      {SECTIONS.map((section) => (
        <View key={section.title} style={{ marginTop: space.lg }}>
          <Text style={styles.sectionLabel}>{section.title}</Text>
          <View style={styles.endpointsCard}>
            {section.endpoints.map((ep, i) => (
              <View key={ep.path + ep.method} style={[styles.endpointRow, i > 0 && styles.endpointBorder]}>
                <View style={styles.endpointHeader}>
                  <MethodPill method={ep.method} />
                  <Text style={styles.path} numberOfLines={1}>{ep.path}</Text>
                </View>
                <Text style={styles.desc}>{ep.desc}</Text>
                {ep.body ? (
                  <View style={styles.bodyBox}>
                    <Text style={styles.bodyText}>{ep.body}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.footer}>
        Rate limits and response shapes may evolve — check the changelog in your dashboard for breaking changes before upgrading production integrations.
      </Text>
    </ScrollView>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    sectionLabel: {
      ...type.small, color: colors.textMuted, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: space.sm,
    },
    paragraph: { ...type.small, color: colors.textSecondary, lineHeight: 18, marginBottom: space.sm },
    codeBox: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
    },
    codeBoxStatic: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md,
    },
    codeText: { ...type.dataSm, fontSize: 13, color: colors.accent },
    codeBlockLarge: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, padding: space.md,
    },
    codeTextMultiline: { ...type.dataSm, fontSize: 12, color: colors.textPrimary, lineHeight: 18 },
    copyHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.sm },
    copyHintText: { ...type.small, color: colors.textMuted },
    endpointsCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, overflow: 'hidden',
    },
    endpointRow: { paddingVertical: space.md },
    endpointBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    endpointHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
    path: { ...type.dataSm, fontSize: 13, color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
    desc: { ...type.small, color: colors.textSecondary, lineHeight: 17 },
    bodyBox: {
      backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
      paddingHorizontal: space.sm, paddingVertical: 6, marginTop: space.xs,
    },
    bodyText: { ...type.dataSm, fontSize: 11, color: colors.textMuted },
    footer: { ...type.small, color: colors.textMuted, marginTop: space.lg, lineHeight: 16 },
  });
}

const docStyles = StyleSheet.create({
  methodPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  methodPillText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
});
