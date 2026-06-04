import { useEffect, useState } from 'react';

/** Recompute executive directive / briefing on this cadence (meeting boundaries, wind-down, etc.). */
export const DIRECTIVE_CLOCK_MS = 60_000;

export function useDirectiveClock(enabled = true, intervalMs = DIRECTIVE_CLOCK_MS): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return tick;
}
