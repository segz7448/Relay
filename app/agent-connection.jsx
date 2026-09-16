import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { AGENT_HOST, MODES, MODE_HELP, agentConfig } from "../agentConnection";
import AgentConsoleIcon from "../components/AgentConsoleIcon";
import {
  copyExactSecret,
  canCloseSecret,
  configWithSecret,
} from "../utils/secretClipboard.mjs";
import {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  rotateAccessKey,
  fetchAccessKeyAudit,
} from "../devPlatformStore";
const C = {
  bg: "#0B0E12",
  panel: "#151920",
  panel2: "#20252D",
  line: "#343B45",
  text: "#F0F3F6",
  muted: "#7E8996",
  orange: "#FF8437",
  green: "#34D399",
  red: "#F87171",
};
export default function AgentConnection() {
  const router = useRouter();
  const [mode, setMode] = useState("Builder"),
    [keys, setKeys] = useState([]),
    [secret, setSecret] = useState(null),
    [secretCopied, setSecretCopied] = useState(false),
    [secretAcknowledged, setSecretAcknowledged] = useState(false),
    [copyStatus, setCopyStatus] = useState(""),
    [audit, setAudit] = useState([]),
    [auditName, setAuditName] = useState(""),
    [phase, setPhase] = useState("loading"),
    [working, setWorking] = useState(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      setKeys(await fetchApiKeys());
      setPhase("ready");
    } catch (e) {
      setError(e.message || "Could not load access keys");
      setPhase("error");
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  async function run(id, fn) {
    setWorking(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Action failed");
    } finally {
      setWorking(null);
    }
  }
  const config = secret
    ? configWithSecret(agentConfig, secret)
    : agentConfig("<ACCESS_KEY>");
  async function copySecretValue(value, label = "Key", marksSecret = true) {
    setCopyStatus("");
    try {
      await copyExactSecret(Clipboard, value);
      if (marksSecret) setSecretCopied(true);
      setCopyStatus(`${label} copied and verified`);
    } catch {
      setSecretCopied(false);
      setCopyStatus(
        "Copy failed. The complete key is selectable below. Try again.",
      );
    }
  }
  function closeSecret() {
    if (
      !canCloseSecret({
        copied: secretCopied,
        acknowledged: secretAcknowledged,
      })
    ) {
      setCopyStatus(
        "Copy the key, or acknowledge that you saved it another way.",
      );
      return;
    }
    setSecret(null);
    setSecretCopied(false);
    setSecretAcknowledged(false);
    setCopyStatus("");
  }
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.nav}>
        <IconButton
          name="back"
          label="Back to Settings"
          onPress={() => router.back()}
        />
        <Text style={s.navTitle}>CONNECT AGENT</Text>
      </View>
      <Text style={s.eyebrow}>RELAY</Text>
      <Text style={s.title}>Agent Control</Text>
      <Text style={s.subtitle}>Provision, observe, revoke.</Text>
      <Panel style={s.status}>
        <IconWell name="relay" />
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>EDGE CONNECTION</Text>
          <Text style={s.statusTitle}>
            {phase === "loading"
              ? "CHECKING API"
              : phase === "error"
                ? "API UNREACHABLE"
                : "API ONLINE"}
          </Text>
          <Text style={s.monoMuted}>HTTPS JSON / zero-trust keys</Text>
        </View>
        <View
          style={[
            s.liveDot,
            phase === "loading" && s.checkingDot,
            phase === "error" && s.offlineDot,
          ]}
        />
      </Panel>
      <Section>ACCESS PROFILE</Section>
      <View style={s.segment}>
        {MODES.map((x) => (
          <Pressable
            key={x}
            accessibilityRole="button"
            accessibilityState={{ selected: x === mode }}
            accessibilityLabel={`${x} access mode`}
            onPress={() => setMode(x)}
            style={[s.mode, x === mode && s.modeOn]}
          >
            <Text style={[s.modeText, x === mode && s.modeTextOn]}>
              {x === "Operator"
                ? "OPERATE"
                : x === "Read only"
                  ? "READ"
                  : x.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.modeHelp}>{MODE_HELP[mode]}</Text>
      <Section>ENDPOINT</Section>
      <Panel style={s.endpoint}>
        <AgentConsoleIcon name="relay" />
        <View style={{ flex: 1 }}>
          <Text selectable style={s.endpointText}>
            {AGENT_HOST.replace(/^https?:\/\//, "")}
          </Text>
          <Text style={s.micro}>TAP ICON TO COPY</Text>
        </View>
        <IconButton
          name="copy"
          label="Copy Relay host"
          onPress={() => copySecretValue(AGENT_HOST, "Relay endpoint", false)}
        />
      </Panel>
      {!!copyStatus && !secret ? <Text accessibilityRole="alert" style={s.copyStatus}>{copyStatus}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Generate ${mode} access key`}
        disabled={working === "create" || !!secret}
        style={s.generate}
        onPress={() =>
          run("create", async () => {
            const x = await createApiKey({
              name: `Agent ${mode}`,
              scope: mode,
            });
            setSecret(x.secret);
            await load();
          })
        }
      >
        {working === "create" ? (
          <ActivityIndicator color="#110D09" />
        ) : (
          <>
            <AgentConsoleIcon name="key" color="#110D09" />
            <Text style={s.generateText}>GENERATE KEY</Text>
          </>
        )}
      </Pressable>
      <Section>
        CREDENTIALS{" "}
        {String(keys.filter((x) => !x.revoked).length).padStart(2, "0")}
      </Section>
      {phase === "loading" ? (
        <Panel style={s.state}>
          <ActivityIndicator color={C.orange} />
          <Text style={s.stateText}>LOADING CREDENTIALS</Text>
        </Panel>
      ) : null}
      {phase === "error" ? (
        <Panel style={s.state}>
          <Text style={s.error}>{error}</Text>
          <IconButton name="retry" label="Retry loading keys" onPress={load} />
        </Panel>
      ) : null}
      {phase === "ready" && !keys.some((x) => !x.revoked) ? (
        <Panel style={s.empty} accessibilityLiveRegion="polite">
          <IconWell name="key" />
          <View>
            <Text style={s.emptyTitle}>NO ACTIVE KEYS</Text>
            <Text style={s.monoMuted}>Generate one to connect an agent.</Text>
          </View>
        </Panel>
      ) : null}
      {phase === "ready" &&
        keys
          .filter((x) => !x.revoked)
          .map((x) => (
            <Panel key={x.id} style={s.credential}>
              <View style={s.credentialTop}>
                <IconWell name="key" small />
                <View style={{ flex: 1 }}>
                  <Text style={s.credentialName}>{x.name.toUpperCase()}</Text>
                  <Text style={s.token}>{x.prefix}••••••••</Text>
                </View>
              </View>
              <View style={s.credentialBottom}>
                <Text style={s.micro}>
                  LAST ACCESS{" "}
                  {x.lastUsedAt
                    ? new Date(x.lastUsedAt).toLocaleTimeString()
                    : "NEVER"}
                </Text>
                <View style={s.actions}>
                  <IconButton
                    name="rotate"
                    label={`Rotate ${x.name}`}
                    busy={working === `rotate-${x.id}`}
                    onPress={() =>
                      run(`rotate-${x.id}`, async () => {
                        const n = await rotateAccessKey(x.id);
                        setSecret(n.secret);
                        await load();
                      })
                    }
                  />
                  <IconButton
                    name="audit"
                    label={`Audit ${x.name}`}
                    busy={working === `audit-${x.id}`}
                    onPress={() =>
                      run(`audit-${x.id}`, async () => {
                        setAuditName(x.name);
                        setAudit(await fetchAccessKeyAudit(x.id));
                      })
                    }
                  />
                  <IconButton
                    name="trash"
                    color={C.red}
                    label={`Revoke ${x.name}`}
                    busy={working === `revoke-${x.id}`}
                    onPress={() =>
                      run(`revoke-${x.id}`, async () =>
                        setKeys(await revokeApiKey(x.id)),
                      )
                    }
                  />
                </View>
              </View>
            </Panel>
          ))}
      <Section>BOOTSTRAP</Section>
      <Panel style={s.bootstrap}>
        <View style={s.bootstrapHead}>
          <Text style={s.filename}>relay-agent.env</Text>
          <IconButton
            name="copy"
            label="Copy full agent bootstrap configuration"
            onPress={() =>
              secret
                ? copySecretValue(config, "Bootstrap")
                : setCopyStatus(
                    "Generate a key before copying bootstrap configuration",
                  )
            }
          />
        </View>
        {config.split("\n").map((line, i) => {
          const [k, ...v] = line.split("=");
          return (
            <View key={i} style={s.codeRow}>
              <Text style={s.codeKey}>{k}</Text>
              <Text
                selectable
                numberOfLines={2}
                style={[
                  s.codeValue,
                  k.includes("KEY") && secret && { color: "#FFB481" },
                ]}
              >
                {v.join("=")}
              </Text>
            </View>
          );
        })}
        <View style={s.secure}>
          <AgentConsoleIcon name="shield" color={C.green} />
          <Text style={s.secureText}>
            Secret revealed once. Never stored on this screen.
          </Text>
        </View>
      </Panel>
      {audit.length ? (
        <>
          <Section>AUDIT / {auditName.toUpperCase()}</Section>
          <Panel style={s.audit}>
            {audit.map((x, i) => (
              <View key={i} style={s.auditRow}>
                <View
                  style={[
                    s.auditDot,
                    {
                      backgroundColor:
                        x.outcome === "allowed"
                          ? C.green
                          : x.outcome === "forbidden"
                            ? C.red
                            : C.orange,
                    },
                  ]}
                />
                <Text numberOfLines={1} style={s.auditPath}>
                  {x.method} {x.path}
                </Text>
                <Text style={s.auditOutcome}>{x.outcome.toUpperCase()}</Text>
              </View>
            ))}
          </Panel>
        </>
      ) : null}
      <Modal
        visible={!!secret}
        transparent
        animationType="fade"
        onRequestClose={closeSecret}
      >
        <View style={s.modalBackdrop}>
          <View style={s.secretModal} accessibilityViewIsModal>
            <View style={s.secretModalHead}>
              <IconWell name="key" />
              <View style={{ flex: 1 }}>
                <Text style={s.secretModalTitle}>ONE-TIME ACCESS KEY</Text>
                <Text style={s.secretWarning}>
                  This complete secret will never be shown again.
                </Text>
              </View>
            </View>
            <Text selectable selectionColor={C.orange} style={s.fullSecret}>
              {secret}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy complete one-time access key"
              style={s.copySecretButton}
              onPress={() => copySecretValue(secret, "Complete key")}
            >
              <AgentConsoleIcon name="copy" color="#110D09" />
              <Text style={s.copySecretText}>
                {secretCopied ? "COPIED + VERIFIED" : "COPY COMPLETE KEY"}
              </Text>
            </Pressable>
            {!!copyStatus && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={[s.copyStatus, !secretCopied && { color: C.red }]}
              >
                {copyStatus}
              </Text>
            )}
            {!secretCopied && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: secretAcknowledged }}
                onPress={() => setSecretAcknowledged((x) => !x)}
                style={s.ackRow}
              >
                <View style={[s.checkbox, secretAcknowledged && s.checkboxOn]}>
                  {secretAcknowledged ? <Ionicons name="checkmark" size={13} color="#110D09" style={s.check} /> : null}
                </View>
                <Text style={s.ackText}>
                  I saved the complete key another way and understand it cannot
                  be recovered.
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close one-time key"
              disabled={
                !canCloseSecret({
                  copied: secretCopied,
                  acknowledged: secretAcknowledged,
                })
              }
              onPress={closeSecret}
              style={[
                s.closeSecret,
                !canCloseSecret({
                  copied: secretCopied,
                  acknowledged: secretAcknowledged,
                }) && s.closeSecretDisabled,
              ]}
            >
              <Text style={s.closeSecretText}>
                {secretCopied ? "DONE" : "I UNDERSTAND — CLOSE"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {error && phase !== "error" ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={s.inlineError}
        >
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}
function Panel({ children, style }) {
  return <View style={[s.panel, style]}>{children}</View>;
}
function Section({ children }) {
  return <Text style={s.section}>{children}</Text>;
}
function IconWell({ name, small }) {
  return (
    <View style={[s.iconWell, small && s.iconWellSmall]}>
      <AgentConsoleIcon name={name} size={small ? 18 : 23} />
    </View>
  );
}
function IconButton({ name, label, onPress, color = C.orange, busy }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      disabled={busy}
      onPress={onPress}
      style={s.iconButton}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <AgentConsoleIcon name={name} color={color} size={19} />
      )}
    </Pressable>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingTop: 50, paddingBottom: 80 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 26,
  },
  navTitle: {
    fontFamily: "monospace",
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: C.orange,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.7,
    color: C.text,
    marginTop: 5,
  },
  subtitle: { fontSize: 15, color: C.muted, marginTop: 2, marginBottom: 24 },
  panel: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 18,
  },
  status: {
    minHeight: 124,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  iconWell: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: C.panel2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWellSmall: { width: 46, height: 46, borderRadius: 14 },
  kicker: { fontFamily: "monospace", fontSize: 10, color: C.muted },
  statusTitle: {
    fontFamily: "monospace",
    fontSize: 21,
    color: C.text,
    marginVertical: 5,
  },
  monoMuted: { fontFamily: "monospace", fontSize: 12, color: C.muted },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.green },
  checkingDot: { backgroundColor: C.orange },
  offlineDot: { backgroundColor: C.red },
  section: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    color: C.muted,
    marginTop: 26,
    marginBottom: 10,
  },
  segment: {
    height: 68,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    padding: 7,
    flexDirection: "row",
    gap: 6,
  },
  mode: {
    flex: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  modeOn: { backgroundColor: C.orange },
  modeText: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "700",
    color: C.muted,
  },
  modeTextOn: { color: "#15100B" },
  modeHelp: {
    fontSize: 13,
    lineHeight: 18,
    color: C.muted,
    marginTop: 8,
    marginHorizontal: 4,
  },
  endpoint: {
    height: 88,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  endpointText: { fontFamily: "monospace", fontSize: 13, color: C.text },
  micro: {
    fontFamily: "monospace",
    fontSize: 9,
    color: C.muted,
    letterSpacing: 0.5,
    marginTop: 5,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.panel2,
    alignItems: "center",
    justifyContent: "center",
  },
  generate: {
    height: 76,
    marginTop: 22,
    borderRadius: 18,
    backgroundColor: C.orange,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  generateText: {
    fontFamily: "monospace",
    fontSize: 18,
    fontWeight: "800",
    color: "#110D09",
  },
  state: {
    height: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stateText: { fontFamily: "monospace", fontSize: 12, color: C.muted },
  error: { flex: 1, fontFamily: "monospace", fontSize: 12, color: C.red },
  empty: {
    height: 112,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  emptyTitle: {
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    marginBottom: 5,
  },
  credential: { padding: 14, marginBottom: 12 },
  credentialTop: { flexDirection: "row", gap: 13, alignItems: "center" },
  credentialName: {
    fontFamily: "monospace",
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
  },
  token: {
    fontFamily: "monospace",
    fontSize: 12,
    color: C.muted,
    marginTop: 5,
  },
  credentialBottom: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: { flexDirection: "row", gap: 8 },
  reveal: {
    marginTop: 12,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderColor: C.orange,
  },
  revealTitle: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
    color: "#FFB481",
  },
  revealCopy: { fontSize: 12, color: C.muted, marginTop: 4 },
  bootstrap: { padding: 16 },
  bootstrapHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  filename: { fontFamily: "monospace", fontSize: 12, color: C.muted },
  codeRow: { paddingVertical: 8 },
  codeKey: { fontFamily: "monospace", fontSize: 10, color: C.muted },
  codeValue: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    color: C.text,
    marginTop: 3,
  },
  secure: {
    borderTopWidth: 1,
    borderTopColor: C.line,
    marginTop: 12,
    paddingTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  secureText: {
    fontFamily: "monospace",
    fontSize: 10,
    color: C.muted,
    flex: 1,
  },
  audit: { padding: 10 },
  auditRow: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  auditDot: { width: 7, height: 7, borderRadius: 4 },
  auditPath: { flex: 1, fontFamily: "monospace", fontSize: 10, color: C.text },
  auditOutcome: { fontFamily: "monospace", fontSize: 9, color: C.muted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    padding: 20,
  },
  secretModal: {
    backgroundColor: C.panel,
    borderColor: C.orange,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
  },
  secretModalHead: { flexDirection: "row", alignItems: "center", gap: 13 },
  secretModalTitle: {
    fontFamily: "monospace",
    color: C.text,
    fontSize: 15,
    fontWeight: "800",
  },
  secretWarning: { color: "#FFB481", fontSize: 12, marginTop: 4 },
  fullSecret: {
    fontFamily: "monospace",
    color: C.text,
    backgroundColor: "#0E1217",
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 18,
  },
  copySecretButton: {
    minHeight: 56,
    backgroundColor: C.orange,
    borderRadius: 16,
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  copySecretText: {
    fontFamily: "monospace",
    color: "#110D09",
    fontWeight: "800",
    fontSize: 14,
  },
  copyStatus: {
    fontFamily: "monospace",
    color: C.green,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
  ackRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginTop: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: C.orange, borderColor: C.orange },
  check: { color: "#110D09", fontWeight: "900" },
  ackText: { flex: 1, color: C.muted, fontSize: 11, lineHeight: 16 },
  closeSecret: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: C.panel2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  closeSecretDisabled: { opacity: 0.35 },
  closeSecretText: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
    color: C.text,
  },
  inlineError: {
    fontFamily: "monospace",
    color: C.red,
    fontSize: 11,
    marginTop: 12,
  },
});
