import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, View, Text, TextInput, FlatList, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { type, space, radius, avatarPalette, useTheme } from '../theme';

// Contacts (unlike files/photos) send instantly with no upload step, so
// this only needs to answer "which one" — a short picker list, not a
// preview-then-send flow. Backed by the device's real contact book via
// expo-contacts (requires the READ_CONTACTS permission).

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function ContactPickerSheet({ visible, onClose, onPick }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'denied' | 'error'
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible || status !== 'idle') return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const { status: perm } = await Contacts.requestPermissionsAsync();
        if (perm !== 'granted') {
          if (!cancelled) setStatus('denied');
          return;
        }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
          sort: Contacts.SortTypes.FirstName,
        });
        if (cancelled) return;
        const flattened = (data ?? [])
          .filter((c) => c.name && c.phoneNumbers?.length)
          .map((c) => ({ id: c.id, name: c.name, phone: c.phoneNumbers[0].number }));
        setContacts(flattened);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [visible, status]);

  // Reset so the next open re-checks permission state if it changed.
  useEffect(() => {
    if (!visible) setStatus('idle');
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [contacts, query]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.wrap, { paddingBottom: insets.bottom + space.sm }]}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Share Contact</Text>
            </View>

            {status === 'ready' && contacts.length > 5 ? (
              <View style={styles.searchRow}>
                <Ionicons name="search" size={14} color={colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search contacts"
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  autoCorrect={false}
                />
              </View>
            ) : null}

            {status === 'loading' ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : status === 'denied' ? (
              <View style={styles.centerBox}>
                <Text style={styles.helperText}>
                  Contacts access is off. Enable it in system settings to share a contact.
                </Text>
                <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
                  <Text style={styles.settingsLink}>Open Settings</Text>
                </Pressable>
              </View>
            ) : status === 'error' ? (
              <View style={styles.centerBox}>
                <Text style={styles.helperText}>Couldn't load contacts.</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.centerBox}>
                <Text style={styles.helperText}>
                  {query ? 'No matching contacts.' : 'No contacts with phone numbers found.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: c, index: i }) => (
                  <Pressable
                    onPress={() => {
                      onClose?.();
                      onPick?.(c);
                    }}
                    style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && { backgroundColor: colors.surfaceRaised }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: avatarPalette[i % avatarPalette.length] }]}>
                      <Text style={styles.avatarText}>{initials(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: space.sm }}>
                      <Text style={styles.name}>{c.name}</Text>
                      <Text style={styles.phone}>{c.phone}</Text>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </Pressable>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.card, styles.cancelCard, pressed && { backgroundColor: colors.surfaceRaised }]}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    wrap: { paddingHorizontal: space.sm, gap: space.sm },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', maxHeight: 420 },
    titleRow: { paddingVertical: space.sm, paddingHorizontal: space.md, alignItems: 'center' },
    title: { ...type.small, color: colors.textMuted, fontWeight: '600' },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginHorizontal: space.md, marginBottom: space.sm,
      backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
      paddingHorizontal: space.sm, height: 32,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: 13, padding: 0 },
    list: { flexGrow: 0 },
    centerBox: { paddingVertical: space.lg, paddingHorizontal: space.md, alignItems: 'center', gap: space.sm },
    helperText: { ...type.small, color: colors.textMuted, textAlign: 'center' },
    settingsLink: { ...type.small, color: colors.accent, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#F2F4F6', fontSize: 13, fontWeight: '600' },
    name: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
    phone: { ...type.small, color: colors.textMuted, marginTop: 1 },
    cancelCard: { alignItems: 'center', paddingVertical: space.md },
    cancelLabel: { ...type.body, color: colors.accent, fontWeight: '700' },
  });
}
