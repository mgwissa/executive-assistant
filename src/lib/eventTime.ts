import { fromZonedTime } from 'date-fns-tz';

/** Convert date/time inputs, interpreted as wall-clock values in `timezone`, to a UTC ISO instant. */
export function zonedDateTimeIso(date: string, time: string, timezone: string): string {
  return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
}

/** Store an inclusive recurrence end date using the event's timezone rather than the browser's. */
export function zonedEndOfDayIso(date: string, timezone: string): string {
  return fromZonedTime(`${date}T23:59:59.999`, timezone).toISOString();
}
