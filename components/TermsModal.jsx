import { useMemo } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { IconGhostButton } from './Button';
import { type, space, radius, useTheme } from '../theme';

// Placeholder legal copy — swap for the real Terms/Privacy content
// whenever that's written; the modal shell and animation stay the same.
export default function TermsModal({ visible, onClose, title, body }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <IconGhostButton icon="close" onPress={onClose} size={34} />
          </View>
          <ScrollView style={{ marginTop: space.md }} showsVerticalScrollIndicator={false}>
            <Text style={styles.body}>{body}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.h1, color: colors.textPrimary },
  body: { ...type.body, color: colors.textSecondary, lineHeight: 21, paddingBottom: space.xl },
});
