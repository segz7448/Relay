// utils/imageUpload.js
//
// PHASE 10 — bot profile photos. `expo-image-picker` only ever hands back a
// device-local `file://` (or blob:) URI. Screens were passing that URI
// straight into `updateBot({ profileImage })`/`createBot({ profileImage })`
// and calling it done — which meant the "photo" only ever existed on the
// device that picked it: reinstall the app, view the bot from another
// account, or let the bot show up in a server's bot list, and there was
// nothing to load. This uploads the picked image to the existing
// `/files/upload` R2-backed endpoint (already used elsewhere, just never
// wired to bot avatars) and returns the persisted `https://` URL that's
// actually safe to store on the bot record.
//
// Not part of Phase 19 (Bot Files: R2 Integration) — that phase is about
// files exchanged between a bot and its bot_users. This is the owner
// picking their own bot's avatar from the BotManager UI, gated by the same
// requireUserSession the rest of `/bots/*` uses, not a bot-runtime concern.

import { guessMime, extensionOf } from './fileTypes';
import { api } from '../api';

// Returns the uploaded https:// URL, or null if `uri` is falsy, already a
// remote URL (nothing to do), or the upload fails (caller decides how to
// surface that — this never throws, so a failed photo upload never blocks
// saving the rest of a bot's profile).
export async function uploadLocalImageIfNeeded(uri) {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri; // already persisted, nothing to do

  try {
    const ext = extensionOf(uri) || 'jpg';
    const formData = new FormData();
    formData.append('file', {
      uri,
      name: `avatar-${Date.now()}.${ext}`,
      type: guessMime(ext),
    });
    const res = await api.uploadFile(formData);
    return res.url;
  } catch (e) {
    console.warn('avatar upload failed:', e.message);
    return null;
  }
}
