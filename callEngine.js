import Constants from "expo-constants";

import { api } from "./api";
const configuredTurn = Constants.expoConfig?.extra?.turn;
export const DEFAULT_ICE_SERVERS = [
  ...(configuredTurn ? [configuredTurn] : []),
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];
export function turnIsConfigured(servers = DEFAULT_ICE_SERVERS) {
  return servers.some(
    (x) =>
      String(x.urls).includes("turn:") || String(x.urls).includes("turns:"),
  );
}
export async function loadIceServers() {
  try {
    const response = await api.getCallIceServers();
    return {
      iceServers: response.iceServers,
      turnConfigured: turnIsConfigured(response.iceServers),
    };
  } catch {
    return {
      iceServers: DEFAULT_ICE_SERVERS,
      turnConfigured: turnIsConfigured(DEFAULT_ICE_SERVERS),
    };
  }
}
function webrtc() {
  return require("react-native-webrtc");
}
export async function microphoneStream() {
  return webrtc().mediaDevices.getUserMedia({ audio: true, video: false });
}
export function createPeer({
  callId,
  onRemoteStream,
  onConnectionState,
  iceServers = DEFAULT_ICE_SERVERS,
}) {
  const peer = new (webrtc().RTCPeerConnection)({ iceServers });
  peer.onicecandidate = (e) => {
    if (e.candidate && callId)
      api.addCallIce(callId, e.candidate.toJSON()).catch(() => {});
  };
  peer.onconnectionstatechange = () =>
    onConnectionState?.(peer.connectionState);
  peer.oniceconnectionstatechange = () =>
    onConnectionState?.(peer.iceConnectionState);
  peer.ontrack = (e) => {
    if (e.streams?.[0]) onRemoteStream?.(e.streams[0]);
  };
  return peer;
}
export async function drainIce(callId, peer, cursor = 0) {
  const rows = await api.listCallIce(callId, cursor);
  for (const row of rows) await peer.addIceCandidate(row.candidate);
  return rows.at(-1)?.createdAt ?? cursor;
}
export function stopMedia(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}
