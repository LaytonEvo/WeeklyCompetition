import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { blockedPeriods } from "@/db/schema";

/**
 * Calendar adapter boundary for importing fitting appointments (or any busy
 * time) from an external calendar — e.g. Google Calendar or fitting-booking
 * software. NO external calendar is connected in this release; the internal
 * availability system is authoritative.
 *
 * To add a provider: implement `CalendarAdapter.listBusy`, register it in
 * ADAPTERS, and call `syncCalendar` from the scheduler tick.
 */
export interface BusyPeriod {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CalendarAdapter {
  /** Stable source name stored on blocked_periods.external_source. */
  source: string;
  listBusy(from: Date, to: Date): Promise<BusyPeriod[]>;
}

export const ADAPTERS: Record<string, CalendarAdapter> = {};

/**
 * Idempotent sync: upserts busy periods as "fitting" blocks keyed by
 * (external_source, external_id) and removes blocks that disappeared upstream.
 * Existing bookings are never cancelled automatically — conflicts surface in
 * the admin bookings list for staff to resolve with the customer.
 */
export async function syncCalendar(adapter: CalendarAdapter, simulatorId: string, from: Date, to: Date) {
  const busy = await adapter.listBusy(from, to);
  await db.transaction(async (tx) => {
    for (const b of busy) {
      await tx
        .insert(blockedPeriods)
        .values({ simulatorId, kind: "fitting", title: b.title || "Fitting", startsAt: b.startsAt, endsAt: b.endsAt, externalSource: adapter.source, externalId: b.externalId })
        .onConflictDoUpdate({ target: [blockedPeriods.externalSource, blockedPeriods.externalId], set: { startsAt: b.startsAt, endsAt: b.endsAt, title: b.title || "Fitting" } });
    }
    const keep = busy.map((b) => b.externalId);
    await tx
      .delete(blockedPeriods)
      .where(and(eq(blockedPeriods.externalSource, adapter.source), eq(blockedPeriods.simulatorId, simulatorId), keep.length ? notInArray(blockedPeriods.externalId, keep) : undefined));
  });
  return busy.length;
}
