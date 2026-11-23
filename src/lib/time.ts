import { DateTime, Interval } from "luxon";

export const DEFAULT_TZ = "Europe/London";

export function nowUtc(): Date {
  return new Date();
}

/** Combine a local calendar date (yyyy-MM-dd) and wall time (HH:mm) in a zone → UTC Date. */
export function localToUtc(date: string, time: string, zone = DEFAULT_TZ): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new Error(`Invalid local date/time ${date} ${time} (${dt.invalidReason})`);
  return dt.toUTC().toJSDate();
}

export function toLocal(d: Date, zone = DEFAULT_TZ): DateTime {
  return DateTime.fromJSDate(d, { zone });
}

export function formatLocal(d: Date | null | undefined, fmt = "ccc d LLL, HH:mm", zone = DEFAULT_TZ): string {
  if (!d) return "—";
  return DateTime.fromJSDate(d, { zone }).toFormat(fmt);
}

export function localDateKey(d: Date, zone = DEFAULT_TZ): string {
  return DateTime.fromJSDate(d, { zone }).toISODate()!;
}

/** ISO weekday 1..7 for a local date string. */
export function isoWeekday(date: string, zone = DEFAULT_TZ): number {
  return DateTime.fromISO(date, { zone }).weekday;
}

/** Every local date (yyyy-MM-dd) from start to end inclusive. */
export function eachLocalDate(startDate: string, endDate: string, zone = DEFAULT_TZ): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(startDate, { zone }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone }).startOf("day");
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function humanDuration(ms: number): string {
  if (ms <= 0) return "Closed";
  const i = Interval.fromDateTimes(DateTime.now(), DateTime.now().plus({ milliseconds: ms }));
  const dur = i.toDuration(["days", "hours", "minutes"]).toObject();
  const d = Math.floor(dur.days ?? 0);
  const h = Math.floor(dur.hours ?? 0);
  const m = Math.floor(dur.minutes ?? 0);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/**
 * Compute the start/end instants of a weekly competition starting on the
 * given local date, honouring GMT/BST: local wall times are preserved.
 */
export function competitionWindow(
  startDate: string,
  startTime: string,
  durationDays: number,
  endTime: string,
  zone = DEFAULT_TZ,
): { startsAt: Date; endsAt: Date } {
  const start = DateTime.fromISO(`${startDate}T${startTime}`, { zone });
  const lastDay = start.plus({ days: durationDays - 1 }).toISODate()!;
  const end = DateTime.fromISO(`${lastDay}T${endTime}`, { zone });
  return { startsAt: start.toUTC().toJSDate(), endsAt: end.toUTC().toJSDate() };
}
