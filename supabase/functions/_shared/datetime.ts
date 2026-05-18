/**
 * Date / timezone helpers shared by the notification Edge Functions.
 *
 * Everything uses `Intl.DateTimeFormat` rather than a date library so the
 * functions stay small and dependency-free.
 */

/** Returns the user's local calendar date as `YYYY-MM-DD`. */
export function localDateString(at: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // `en-CA` already formats as `YYYY-MM-DD`.
  return fmt.format(at);
}

/** Returns the user's local clock time as `HH:MM` (24h). */
export function localTimeString(at: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(at);
}

/**
 * Compares two `HH:MM` strings. Returns negative when `a < b`, positive when
 * `a > b`, zero when equal.
 */
export function compareTimeStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** `'07:30:00'` (Postgres `time`) -> `'07:30'`. */
export function trimSeconds(hhmmss: string): string {
  return hhmmss.length >= 5 ? hhmmss.slice(0, 5) : hhmmss;
}

/** Friendly day label, e.g. `Monday, May 18`. */
export function friendlyDateLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(at);
}

/** Friendly event time label, e.g. `9:00 AM`. */
export function friendlyTimeLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
}
