export async function copyExactSecret(clipboard, secret) {
  if (typeof secret !== "string" || !secret.length)
    throw new Error("missing_secret");
  await clipboard.setStringAsync(secret);
  if (typeof clipboard.getStringAsync === "function") {
    const readback = await clipboard.getStringAsync();
    if (readback !== secret) throw new Error("clipboard_verification_failed");
  }
  return secret;
}
export function canCloseSecret({ copied, acknowledged }) {
  return copied || acknowledged;
}
export function configWithSecret(makeConfig, secret) {
  if (!secret || secret.includes("•") || secret.includes("<ACCESS_KEY>"))
    throw new Error("complete_secret_required");
  return makeConfig(secret);
}
