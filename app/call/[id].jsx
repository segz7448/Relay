import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View, Text, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../api";
import {
  createPeer,
  loadIceServers,
  drainIce,
  microphoneStream,
  stopMedia,
} from "../../callEngine";
import { useCall } from "../../callStore";
import { Platform } from "react-native";
const InCallManager = Platform.OS === "web" ? { start() {}, stop() {}, setForceSpeakerphoneOn() {} } : require("react-native-incall-manager").default;
import { takeCallSession } from "../../callSession";
import { type, space, useTheme } from "../../theme";
import {
  callStatus,
  setAudioMuted,
  shouldFailDisconnected,
} from "../../callLifecycle.mjs";
export default function Call() {
  const { id } = useLocalSearchParams(),
    router = useRouter(),
    { colors } = useTheme(),
    s = useMemo(() => styles(colors), [colors]),
    { refresh } = useCall(),
    [call, setCall] = useState(null),
    [status, setStatus] = useState("Connecting…"),
    [muted, setMuted] = useState(false),
    [turnReady, setTurnReady] = useState(false),
    [speaker, setSpeaker] = useState(false),
    [connection, setConnection] = useState("new");
  const peer = useRef(),
    stream = useRef(),
    iceCursor = useRef(0),
    poll = useRef(),
    disconnectedAt = useRef(0),
    ending = useRef(false);
  useEffect(() => {
    let alive = true;
    InCallManager.start({ media: "audio", auto: true, ringback: "_DEFAULT_" });
    (async () => {
      const c = await api.getCall(id);
      if (!alive) return;
      setCall(c);
      setStatus(callStatus(c));
      const held = takeCallSession(id);
      if (held) {
        peer.current = held.peer;
        stream.current = held.stream;
        setTurnReady(held.turnConfigured);
        peer.current.onicecandidate = (e) => {
          if (e.candidate)
            api.addCallIce(id, e.candidate.toJSON()).catch(() => {});
        };
        wirePeer(peer.current);
      } else {
        stream.current = await microphoneStream();
        const ice = await loadIceServers();
        setTurnReady(ice.turnConfigured);
        peer.current = createPeer({
          callId: id,
          iceServers: ice.iceServers,
          onConnectionState: handleConnection,
        });
        stream.current
          .getTracks()
          .forEach((t) => peer.current.addTrack(t, stream.current));
        if (c.direction === "incoming")
          await peer.current.setRemoteDescription(c.offer);
        else
          throw new Error(
            "Reopen the call from the originating device to continue connecting",
          );
      }
      poll.current = setInterval(async () => {
        const n = await api.getCall(id);
        if (!alive) return;
        setCall(n);
        setStatus(callStatus(n, connection));
        if (n.state === "ended") {
          cleanup();
          return;
        }
        if (
          c.direction === "outgoing" &&
          n.answer &&
          !peer.current.remoteDescription
        ) {
          await peer.current.setRemoteDescription(n.answer);
          setStatus("Connected");
        }
        if (shouldFailDisconnected(disconnectedAt.current, Date.now()))
          await end("ice_failed");
        iceCursor.current = await drainIce(id, peer.current, iceCursor.current);
      }, 1200);
    })().catch(async (e) => {
      setStatus(
        e?.name === "NotAllowedError"
          ? "Microphone permission denied"
          : e.message || "Call failed",
      );
      if (!ending.current) await api.endCall(id, "failed").catch(() => {});
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active")
        api
          .getCall(id)
          .then((n) => {
            setCall(n);
            setStatus(callStatus(n, connection));
          })
          .catch(() => {});
    });
    return () => {
      alive = false;
      appState.remove();
      cleanup();
    };
  }, [id]);
  function handleConnection(next) {
    setConnection(next);
    if (["connected", "completed"].includes(next)) {
      disconnectedAt.current = 0;
      setStatus("Connected");
    } else if (next === "disconnected") {
      disconnectedAt.current ||= Date.now();
      setStatus("Reconnecting…");
      peer.current?.restartIce?.();
    } else if (next === "failed") {
      disconnectedAt.current ||= Date.now() - 12_000;
      setStatus("Connection failed");
    }
  }
  function wirePeer(p) {
    p.onconnectionstatechange = () => handleConnection(p.connectionState);
    p.oniceconnectionstatechange = () => handleConnection(p.iceConnectionState);
  }
  function cleanup() {
    clearInterval(poll.current);
    peer.current?.close();
    stopMedia(stream.current);
    InCallManager.stop();
    refresh();
  }
  async function answer() {
    const answer = await peer.current.createAnswer();
    await peer.current.setLocalDescription(answer);
    await api.answerCall(id, answer);
    setStatus("Connected");
  }
  async function end(reason = "ended") {
    if (ending.current) return;
    ending.current = true;
    await api.endCall(id, reason);
    cleanup();
    router.back();
  }
  function mute() {
    const next = !muted;
    setAudioMuted(stream.current, next);
    setMuted(next);
  }
  function toggleSpeaker() {
    const next = !speaker;
    InCallManager.setSpeakerphoneOn(next);
    setSpeaker(next);
  }
  return (
    <View style={s.screen}>
      <View style={s.avatar}>
        <Ionicons name="person" size={52} color="#fff" />
      </View>
      <Text style={s.title}>Relay voice call</Text>
      <Text style={s.status}>{status}</Text>
      {!turnReady ? (
        <Text style={s.warning}>
          Direct peer connection only. Calls may fail on restrictive networks
          until TURN is configured.
        </Text>
      ) : null}
      <View style={s.actions}>
        {call?.direction === "incoming" && call.state === "ringing" ? (
          <Button
            icon="call"
            label="Answer"
            color={colors.online}
            onPress={answer}
          />
        ) : null}
        <Button
          icon={speaker ? "volume-high" : "volume-medium"}
          label={speaker ? "Speaker" : "Earpiece"}
          color={colors.surfaceRaised}
          onPress={toggleSpeaker}
        />
        <Button
          icon={muted ? "mic-off" : "mic"}
          label={muted ? "Unmute" : "Mute"}
          color={colors.surfaceRaised}
          onPress={mute}
        />
        <Button
          icon="call"
          label={
            call?.direction === "incoming" && call.state === "ringing"
              ? "Reject"
              : "End"
          }
          color={colors.danger}
          rotate
          onPress={() => end(call?.state === "ringing" ? "rejected" : "ended")}
        />
      </View>
    </View>
  );
}
function Button({ icon, label, color, onPress, rotate }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={icon}
          size={28}
          color="#fff"
          style={rotate ? { transform: [{ rotate: "135deg" }] } : null}
        />
      </View>
      <Text style={{ color: "#fff" }}>{label}</Text>
    </Pressable>
  );
}
const styles = (c) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: "#111820",
      alignItems: "center",
      padding: space.xl,
      paddingTop: 100,
    },
    avatar: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { ...type.h1, color: "#fff", marginTop: space.xl },
    status: { ...type.body, color: "#b8c1cb", marginTop: space.sm },
    warning: {
      ...type.small,
      color: "#f2b35d",
      textAlign: "center",
      marginTop: space.lg,
      maxWidth: 320,
      lineHeight: 18,
    },
    actions: {
      marginTop: "auto",
      marginBottom: 60,
      flexDirection: "row",
      gap: 34,
      alignItems: "center",
    },
  });
