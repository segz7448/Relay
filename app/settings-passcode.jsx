import { useEffect, useMemo, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { type, space, useTheme } from '../theme';
import SettingsSection from '../components/SettingsSection';
import SettingsRow from '../components/SettingsRow';
import ActionSheet from '../components/ActionSheet';
import OtpInput from '../components/OtpInput';
import { TextLink } from '../components/Button';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import {
  usePrivacySecurity,
  savePasscodeSecret,
  readPasscodeSecret,
  clearPasscodeSecret,
} from '../privacySecurity';

const AUTO_LOCK_OPTIONS = ['Immediately', '1 minute', '5 minutes', '1 hour'];

function labelFor(types) {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris Unlock';
  return 'Biometric Unlock';
}

// step: null | 'enter-current' | 'enter-new' | 'confirm-new'
// purpose: 'enable' | 'disable' | 'change'
export default function PasscodeLockScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { state, setPasscodeMeta } = usePrivacySecurity();
  const { passcode } = state;
  const toast = useToast();
  const confirm = useConfirm();

  const [step, setStep] = useState(null);
  const [purpose, setPurpose] = useState(null);
  const [code, setCode] = useState('');
  const [firstEntry, setFirstEntry] = useState('');
  const [error, setError] = useState(false);
  const [autoLockSheet, setAutoLockSheet] = useState(false);

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLabel, setBioLabel] = useState('Biometric Unlock');
  const [bioBusy, setBioBusy] = useState(false);
  const [bioNote, setBioNote] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
        const types = hasHardware ? await LocalAuthentication.supportedAuthenticationTypesAsync() : [];
        setBioLabel(labelFor(types));
        setBioAvailable(!!enrolled);
        if (hasHardware && !enrolled) {
          setBioNote(`Set up ${labelFor(types)} in your device settings to use it here.`);
        }
      } catch {
        setBioAvailable(false);
      }
    })();
  }, []);

  async function handleToggleBiometric(value) {
    if (!value) {
      setPasscodeMeta({ biometric: false });
      return;
    }
    setBioBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${bioLabel} for botmanager`,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setPasscodeMeta({ biometric: true });
        toast.success(`${bioLabel} enabled`);
      }
    } finally {
      setBioBusy(false);
    }
  }

  function reset() {
    setStep(null);
    setPurpose(null);
    setCode('');
    setFirstEntry('');
    setError(false);
  }

  function startEnable() {
    setPurpose('enable');
    setStep('enter-new');
    setCode('');
    setError(false);
  }

  function startDisable() {
    setPurpose('disable');
    setStep('enter-current');
    setCode('');
    setError(false);
  }

  function startChange() {
    setPurpose('change');
    setStep('enter-current');
    setCode('');
    setError(false);
  }

  async function handleComplete(value) {
    if (step === 'enter-current') {
      const stored = await readPasscodeSecret();
      if (value !== stored) {
        setError(true);
        setTimeout(() => { setCode(''); setError(false); }, 500);
        return;
      }
      if (purpose === 'disable') {
        const ok = await confirm({
          title: 'Turn Off Passcode Lock?',
          message: 'You won\u2019t be asked for a passcode when opening botmanager anymore.',
          confirmLabel: 'Turn Off',
          destructive: true,
          onConfirm: async () => {
            await clearPasscodeSecret();
            setPasscodeMeta({ enabled: false, biometric: false });
          },
        });
        reset();
        if (ok) toast.success('Passcode Lock turned off');
      } else {
        // 'change' — current verified, now collect the new one
        setStep('enter-new');
        setCode('');
      }
      return;
    }

    if (step === 'enter-new') {
      setFirstEntry(value);
      setStep('confirm-new');
      setCode('');
      return;
    }

    if (step === 'confirm-new') {
      if (value !== firstEntry) {
        setError(true);
        setTimeout(() => { setCode(''); setError(false); setStep('enter-new'); setFirstEntry(''); }, 500);
        return;
      }
      await savePasscodeSecret(value);
      setPasscodeMeta({ enabled: true });
      toast.success(purpose === 'change' ? 'Passcode changed' : 'Passcode Lock turned on');
      reset();
    }
  }

  function onCodeChange(value) {
    setCode(value);
    if (value.length === 4) handleComplete(value);
  }

  if (step) {
    const title =
      step === 'enter-current' ? 'Enter Current Passcode'
      : step === 'enter-new' ? 'Enter New Passcode'
      : 'Confirm New Passcode';
    return (
      <View style={[styles.stepWrap, { backgroundColor: colors.bg }]}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepHelper}>
          {step === 'enter-current' ? 'Verify it\u2019s you before making changes.' : 'Choose 4 digits you\u2019ll remember.'}
        </Text>
        <OtpInput length={4} value={code} onChange={onCodeChange} error={error} />
        {error ? <Text style={styles.errorText}>That didn\u2019t match. Try again.</Text> : null}
        <TextLink label="Cancel" onPress={reset} muted />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
      <SettingsSection footer="When on, botmanager will ask for this passcode when you open the app or return to it after being away.">
        <SettingsRow
          icon="keypad"
          iconColor="#5856D6"
          label="Passcode Lock"
          toggle={{ value: passcode.enabled, onValueChange: (v) => (v ? startEnable() : startDisable()) }}
        />
      </SettingsSection>

      {passcode.enabled ? (
        <SettingsSection
          footer={!bioAvailable ? bioNote : `${bioLabel} lets you skip typing your passcode most of the time — it's still required as a fallback.`}
        >
          <SettingsRow icon="key" iconColor="#34C759" label="Change Passcode" onPress={startChange} />
          <SettingsRow
            icon="time"
            iconColor="#FF9500"
            label="Auto-Lock"
            value={passcode.autoLock}
            onPress={() => setAutoLockSheet(true)}
          />
          <SettingsRow
            icon={bioLabel === 'Face ID' ? 'scan' : 'finger-print'}
            iconColor="#007AFF"
            label={`Unlock with ${bioLabel}`}
            disabled={!bioAvailable || bioBusy}
            toggle={{ value: passcode.biometric && bioAvailable, onValueChange: handleToggleBiometric }}
          />
        </SettingsSection>
      ) : null}

      <ActionSheet
        visible={autoLockSheet}
        onClose={() => setAutoLockSheet(false)}
        title="Auto-Lock"
        actions={AUTO_LOCK_OPTIONS.map((opt) => ({
          key: opt,
          label: opt,
          icon: passcode.autoLock === opt ? 'radio-button-on' : 'radio-button-off',
          onPress: () => setPasscodeMeta({ autoLock: opt }),
        }))}
      />
    </View>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    stepWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
    stepTitle: { ...type.h1, color: colors.textPrimary },
    stepHelper: { ...type.body, color: colors.textMuted, textAlign: 'center', marginBottom: space.md },
    errorText: { ...type.small, color: colors.danger, marginTop: -space.sm, marginBottom: space.sm },
  });
}
