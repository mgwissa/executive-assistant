/** Formats a duration as H:MM:SS or M:SS when under an hour. */
export function formatDurationSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Compact duration for chart tooltips and axis hints (e.g. 2h 15m, 45m). */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return '0m';
}

export function entryDurationSeconds(e: { started_at: string; ended_at: string }): number {
  return Math.max(
    0,
    Math.floor((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000),
  );
}
