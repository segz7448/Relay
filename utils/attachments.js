// utils/attachments.js — helpers for attachments served by auth-gated
// Worker routes (e.g. GET /bots/:id/files/:fileId, which requires the
// session bearer token).
//
// Native <Image> and expo-av can send an Authorization header when it is
// part of the source object, so on native we hand them the absolute URL
// plus authHeaders(). The web <img>/<audio> elements cannot set headers,
// so on web we fetch the bytes with the header and hand back a blob:
// object URL instead.

import { Platform } from 'react-native';
import { API_URL } from '../config';
import { getSessionToken } from '../api';

export function absoluteApiUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('file:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function authHeaders() {
  const token = getSessionToken();
  // Web never gets header-based sources (see module note) — blob URLs
  // carry no headers, so returning undefined there is correct, not a gap.
  if (!token || Platform.OS === 'web') return undefined;
  return { Authorization: `Bearer ${token}` };
}

// Resolve an auth-gated attachment URL to a directly renderable URI.
// Web: fetched with the session token and exposed as a blob: object URL.
// Native: the absolute URL itself (the caller passes authHeaders() to the
// Image/Audio source alongside it).
export async function resolveAuthedUri(url) {
  const absolute = absoluteApiUrl(url);
  if (Platform.OS !== 'web') return absolute;
  if (absolute.startsWith('blob:')) return absolute;
  const token = getSessionToken();
  if (!token) return absolute;
  const res = await fetch(absolute, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`attachment_fetch_${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
