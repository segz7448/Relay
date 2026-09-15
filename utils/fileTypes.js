// utils/fileTypes.js
//
// Central mapping from a file extension to how it should look in the
// chat: icon, tint color, and a short label. Used by the attachment
// preview sheet and the file message bubble so both agree on the same
// visual language (colored icon tiles, the way Telegram's Saved
// Messages / file bubbles color-code PDF vs Word vs Zip etc).
//
// Anything not in EXT_MAP still renders — it just falls through to the
// generic "file" tile — so unknown extensions are never a dead end.

const EXT_MAP = {
  pdf: { icon: 'file-pdf-box', color: '#E5584D', label: 'PDF Document' },

  doc: { icon: 'file-word-box', color: '#3D6EE0', label: 'Word Document' },
  docx: { icon: 'file-word-box', color: '#3D6EE0', label: 'Word Document' },

  xls: { icon: 'file-excel-box', color: '#2E9E5B', label: 'Excel Spreadsheet' },
  xlsx: { icon: 'file-excel-box', color: '#2E9E5B', label: 'Excel Spreadsheet' },
  csv: { icon: 'file-delimited-outline', color: '#2E9E5B', label: 'CSV Spreadsheet' },

  ppt: { icon: 'file-powerpoint-box', color: '#E5883D', label: 'PowerPoint Presentation' },
  pptx: { icon: 'file-powerpoint-box', color: '#E5883D', label: 'PowerPoint Presentation' },

  txt: { icon: 'file-document-outline', color: '#8B98A3', label: 'Text File' },
  json: { icon: 'code-json', color: '#4FB3D1', label: 'JSON File' },
  xml: { icon: 'xml', color: '#4FB3D1', label: 'XML File' },

  zip: { icon: 'zip-box-outline', color: '#8A5AC9', label: 'Zip Archive' },
  rar: { icon: 'zip-box-outline', color: '#8A5AC9', label: 'RAR Archive' },
  '7z': { icon: 'zip-box-outline', color: '#8A5AC9', label: '7Z Archive' },

  apk: { icon: 'android', color: '#5FB865', label: 'Android Package' },
};

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac']);

const GENERIC = { icon: 'file-outline', color: '#8B98A3', label: 'File' };

export function extensionOf(filename = '') {
  const clean = filename.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

// Coarse bucket used to decide which bubble layout to use.
export function mediaKindOf(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'document';
}

export function fileVisualFor(ext) {
  if (IMAGE_EXT.has(ext)) return { icon: 'file-image-outline', color: '#3D9BFF', label: 'Image' };
  if (VIDEO_EXT.has(ext)) return { icon: 'file-video-outline', color: '#9C5AE5', label: 'Video' };
  if (AUDIO_EXT.has(ext)) return { icon: 'file-music-outline', color: '#E5584D', label: 'Audio' };
  return EXT_MAP[ext] ?? GENERIC;
}

const MIME_MAP = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  apk: 'application/vnd.android.package-archive',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

export function guessMime(ext) {
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A natural-looking amplitude waveform (values 0..1) for voice messages —
// a smoothed random walk rather than pure noise, so it reads as speech
// rather than static. Used as the live fallback while recording without
// real mic metering (web, denied permission, simulator), and to backfill
// any mock voice message that wasn't captured with its own samples.
export function synthesizeWaveform(count = 32) {
  const bars = [];
  let v = 0.35;
  for (let i = 0; i < count; i++) {
    v += (Math.random() - 0.5) * 0.5;
    v = Math.max(0.08, Math.min(1, v));
    bars.push(Number(v.toFixed(2)));
  }
  return bars;
}
