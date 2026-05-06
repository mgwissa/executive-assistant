/** Turn user input into a safe external href (https default). Returns null if invalid. */
export function externalHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch {
    return null;
  }
}
