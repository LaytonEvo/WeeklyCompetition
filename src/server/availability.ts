import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, type DbOrTx } from "@/db";
import { availabilityRules, blockedPeriods, bookings, simulators } from "@/db/schema";
import { DEFAULT_TZ, eachLocalDate, overlaps } from "@/lib/time";

export type SlotStatus = "available" | "full" | "unavailable" | "past";
export interface Slot {
  startsAt: Date;
  endsAt: Date;
  status: SlotStatus;
  remaining: number;
  reason?: string;
}
export interface DaySlots {
  date: string;
  label: string;
  closed: boolean;
  slots: Slot[];
}

type Rule = typeof availabilityRules.$inferSelect;
type Block = typeof blockedPeriods.$inferSelect;

/** Bookings that consume simulator capacity right now. */
export const ACTIVE_BOOKING = (now: Date) =>
  or(
    inArray(bookings.status, ["confirmed", "checked_in", "completed"]),
    and(eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now)),
  );

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Intersect two lists of [start,end) minute ranges. */
function intersect(a: [number, number][], b: [number, number][]) {
  const out: [number, number][] = [];
  for (const [as, ae] of a) for (const [bs, be] of b) {
    const s = Math.max(as, bs);
    const e = Math.min(ae, be);
    if (s < e) out.push([s, e]);
  }
  return out;
}

/** Expand blocks (one-off and weekly recurring) into concrete intervals for a local date. */
export function blocksForDate(blocks: Block[], date: string, zone = DEFAULT_TZ): { start: Date; end: Date; title: string }[] {
  const day = DateTime.fromISO(date, { zone });
  const dayStart = day.startOf("day").toUTC().toJSDate();
  const dayEnd = day.endOf("day").toUTC().toJSDate();
  const out: { start: Date; end: Date; title: string }[] = [];
  for (const b of blocks) {
    if (b.startsAt && b.endsAt) {
      if (overlaps(b.startsAt, b.endsAt, dayStart, dayEnd)) out.push({ start: b.startsAt, end: b.endsAt, title: b.title });
    } else if (b.recurringWeekday && b.recurringStart && b.recurringEnd && day.weekday === b.recurringWeekday) {
      const start = DateTime.fromISO(`${date}T${b.recurringStart}`, { zone }).toUTC().toJSDate();
      const end = DateTime.fromISO(`${date}T${b.recurringEnd}`, { zone }).toUTC().toJSDate();
      if (b.recurringFrom && end <= b.recurringFrom) continue;
      if (b.recurringUntil && start >= b.recurringUntil) continue;
      out.push({ start, end, title: b.title });
    }
  }
  return out;
}

export interface SlotQuery {
  simulatorId: string;
  window: { startsAt: Date; endsAt: Date };
  fromDate: string;
  toDate: string;
  /** Number of consecutive slot lengths required (e.g. 2 rounds = 2 slots). */
  slotsNeeded?: number;
  now?: Date;
  minNoticeMinutes?: number;
  /** Staff override: ignore notice period and past-slot restriction for the current slot. */
  staffView?: boolean;
}

export async function computeSlots(q: SlotQuery, tx: DbOrTx = db): Promise<DaySlots[]> {
  const now = q.now ?? new Date();
  const [sim] = await tx.select().from(simulators).where(eq(simulators.id, q.simulatorId));
  if (!sim) return [];
  const zone = DEFAULT_TZ;
  const slotLen = sim.slotMinutes;
  const need = Math.max(1, q.slotsNeeded ?? 1);
  const rules = await tx.select().from(availabilityRules).where(eq(availabilityRules.simulatorId, sim.id));
  const rangeStart = DateTime.fromISO(q.fromDate, { zone }).startOf("day").toUTC().toJSDate();
  const rangeEnd = DateTime.fromISO(q.toDate, { zone }).endOf("day").toUTC().toJSDate();
  const blocks = await tx
    .select()
    .from(blockedPeriods)
    .where(
      and(
        eq(blockedPeriods.simulatorId, sim.id),
        or(
          and(isNotNull(blockedPeriods.startsAt), lt(blockedPeriods.startsAt, rangeEnd), gt(blockedPeriods.endsAt, rangeStart)),
          and(isNull(blockedPeriods.startsAt), isNotNull(blockedPeriods.recurringWeekday)),
        ),
      ),
    );
  const bks = await tx
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(and(eq(bookings.simulatorId, sim.id), lt(bookings.startsAt, rangeEnd), gt(bookings.endsAt, rangeStart), ACTIVE_BOOKING(now)));

  const hasWindows = rules.some((r: Rule) => r.kind === "competition_window");
  const notice = q.staffView ? 0 : (q.minNoticeMinutes ?? 0);
  const earliest = new Date(now.getTime() + notice * 60_000);

  return eachLocalDate(q.fromDate, q.toDate, zone).map((date) => {
    const day = DateTime.fromISO(date, { zone });
    const wd = day.weekday;
    const open = rules.filter((r) => r.kind === "opening_hours" && r.weekday === wd).map((r) => [minutes(r.startTime), minutes(r.endTime)] as [number, number]);
    const windows = rules.filter((r) => r.kind === "competition_window" && r.weekday === wd).map((r) => [minutes(r.startTime), minutes(r.endTime)] as [number, number]);
    const ranges = hasWindows ? intersect(open, windows) : open;
    const dayBlocks = blocksForDate(blocks, date, zone);
    const slots: Slot[] = [];
    for (const [rs, re] of ranges) {
      for (let m = rs; m + slotLen * need <= re; m += slotLen) {
        // Wall-clock construction handles GMT/BST: build from local hour/minute, not elapsed minutes from midnight.
        const startsAt = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, hour: Math.floor(m / 60), minute: m % 60 }, { zone }).toUTC().toJSDate();
        const endsAt = new Date(startsAt.getTime() + slotLen * need * 60_000);
        let status: SlotStatus = "available";
        let reason: string | undefined;
        let remaining = sim.slotCapacity;
        if (startsAt < q.window.startsAt || endsAt > q.window.endsAt) {
          status = "unavailable";
          reason = "Outside competition dates";
        } else if (!sim.available) {
          status = "unavailable";
          reason = sim.unavailableReason ?? "Simulator unavailable";
        } else if (startsAt < earliest && !(q.staffView && endsAt > now)) {
          status = "past";
        } else {
          const block = dayBlocks.find((b) => overlaps(b.start, b.end, startsAt, endsAt));
          if (block) {
            status = "unavailable";
            reason = "Reserved";
          } else {
            const used = bks.filter((b) => overlaps(b.startsAt, b.endsAt, startsAt, endsAt)).length;
            remaining = Math.max(0, sim.slotCapacity - used);
            if (remaining === 0) status = "full";
          }
        }
        slots.push({ startsAt, endsAt, status, remaining: status === "available" ? remaining : 0, reason });
      }
    }
    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { date, label: day.toFormat("ccc d LLL"), closed: ranges.length === 0, slots };
  });
}

/** Count capacity-consuming bookings overlapping an interval (call under the simulator lock). */
export async function overlappingCount(tx: DbOrTx, simulatorId: string, startsAt: Date, endsAt: Date, now = new Date(), excludeBookingId?: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.simulatorId, simulatorId),
        lt(bookings.startsAt, endsAt),
        gt(bookings.endsAt, startsAt),
        ACTIVE_BOOKING(now),
        excludeBookingId ? sql`${bookings.id} <> ${excludeBookingId}` : undefined,
      ),
    );
  return n;
}

/** Serialise all capacity decisions for one simulator within the current transaction. */
export async function lockSimulator(tx: DbOrTx, simulatorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"sim:" + simulatorId}))`);
}
