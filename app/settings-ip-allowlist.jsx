import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, useTheme } from '../theme';
import Field from '../components/Field';
import { SkeletonBox } from '../components/Skeleton';
import { ErrorState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import { fetchDevSettings, updateDevSettings } from '../devPlatformStore';

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export default function IpAllowlistScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const toast = useToast();
  const [allowlist, setAllowlist] = useState([]);
  const [ipInput, setIpInput] = useState('');
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'

  const load = useCallback(() => {
    setPhase((p) => (p === 'error' ? 'loading' : p));
    fetchDevSettings()
      .then((s) => {
        setAllowlist(s.ipAllowlist || []);
        setPhase('ready');
      })
      .catch(() => setPhase('error'));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function persist(next, previous) {
    setAllowlist(next);
    updateDevSettings({ ipAllowlist: next }).catch(() => {
      setAllowlist(previous);
      toast.error("Couldn't update your IP allowlist");
    });
  }

  function addIp() {
    const ip = ipInput.trim();
    if (!ip) return;
    if (!IP_RE.test(ip)) {
      setError('Enter a valid IPv4 address, optionally with a /CIDR suffix.');
      return;
    }
    if (allowlist.includes(ip)) {
      setIpInput('');
      setError(null);
      return;
    }
    persist([...allowlist, ip], allowlist);
    setIpInput('');
    setError(null);
  }

  function removeIp(ip) {
    persist(allowlist.filter((x) => x !== ip), allowlist);
  }

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
        <SkeletonBox width="90%" height={13} radius={4} style={{ marginBottom: 8 }} />
        <SkeletonBox width="60%" height={13} radius={4} style={{ marginBottom: space.md }} />
        <SkeletonBox width="100%" height={46} radius={radius.md} />
        <SkeletonBox width="100%" height={90} radius={radius.md} style={{ marginTop: space.sm }} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Couldn't load your IP allowlist." onRetry={load} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.lg }}>
        <Text style={styles.helperTop}>
          Restrict every API key and webhook on this account to specific IP addresses. Leave empty to allow requests from anywhere.
        </Text>
        <View style={styles.inputRow}>
          <View style={{ flex: 1 }}>
            <Field
              placeholder="e.g. 203.0.113.42 or 203.0.113.0/24"
              value={ipInput}
              onChangeText={(v) => { setIpInput(v); setError(null); }}
              icon="globe-outline"
              keyboardType="numbers-and-punctuation"
              error={error}
            />
          </View>
          <Pressable onPress={addIp} style={styles.addBtn}>
            <Ionicons name="add" size={20} color={colors.onAccent} />
          </Pressable>
        </View>

        {allowlist.length > 0 ? (
          <View style={styles.list}>
            {allowlist.map((ip, i) => (
              <View key={ip} style={[styles.row, i > 0 && styles.rowBorder]}>
                <Ionicons name="globe-outline" size={16} color={colors.textMuted} />
                <Text style={styles.ipText}>{ip}</Text>
                <Pressable onPress={() => removeIp(ip)} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>No restrictions — requests accepted from any IP address.</Text>
        )}
      </View>
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    helperTop: { ...type.small, color: colors.textMuted, marginBottom: space.md, lineHeight: 16 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
    addBtn: {
      width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.accent,
      alignItems: 'center', justifyContent: 'center',
    },
    list: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.md, paddingHorizontal: space.md, overflow: 'hidden', marginTop: space.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    ipText: { ...type.dataSm, fontSize: 14, color: colors.textPrimary, flex: 1 },
    empty: { ...type.small, color: colors.textMuted, marginTop: space.md, lineHeight: 16 },
  });
}
