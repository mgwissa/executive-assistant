export function randomUUID(): string {
  // Prefer the native implementation when available.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  // RFC4122 v4 fallback using getRandomValues.
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // Set version to 4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant to RFC4122
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort (non-crypto) fallback: still unique enough for optimistic ids.
  return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

