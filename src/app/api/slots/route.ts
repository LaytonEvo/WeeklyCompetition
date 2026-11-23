import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { DEFAULT_TZ } from "@/lib/time";
import { computeSlots } from "@/server/availability";

export const dynamic = "force-dynamic";

/** Public availability for the booking calendar. Reveals only free/full/unavailable — never who booked. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("competitionId") ?? "";
  const rounds = Math.min(Math.max(Number(req.nextUrl.searchParams.get("rounds")) || 1, 1), 10);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c || !["scheduled", "open"].includes(c.status)) return NextResponse.json({ days: [] });
  const s = await getSettings();
  const now = new Date();
  const start = DateTime.max(DateTime.fromJSDate(now, { zone: DEFAULT_TZ }), DateTime.fromJSDate(c.startsAt, { zone: DEFAULT_TZ }));
  const end = DateTime.min(DateTime.fromJSDate(c.endsAt, { zone: DEFAULT_TZ }), DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).plus({ days: s.booking.bookingHorizonDays }));
  if (end < start) return NextResponse.json({ days: [] });
  const days = await computeSlots({
    simulatorId: c.simulatorId,
    window: c,
    fromDate: start.toISODate()!,
    toDate: end.toISODate()!,
    slotsNeeded: rounds,
    now,
    minNoticeMinutes: s.booking.minNoticeMinutes,
  });
  return NextResponse.json(
    {
      days: days.map((d) => ({
        date: d.date,
        label: d.label,
        closed: d.closed,
        slots: d.slots.filter((x) => x.status !== "past").map((x) => ({ startsAt: x.startsAt.toISOString(), status: x.status, time: DateTime.fromJSDate(x.startsAt, { zone: DEFAULT_TZ }).toFormat("HH:mm") })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
