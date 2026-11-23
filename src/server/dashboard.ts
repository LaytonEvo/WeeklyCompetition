import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { bookings, competitions, customers, fittingEnquiries, hioClaims, payments, rounds, shots } from "@/db/schema";
import { DEFAULT_TZ } from "@/lib/time";
import { getFeaturedCompetition } from "./competitions";
import { getStandings } from "./leaderboard";

export async function dashboardKpis() {
  const now = DateTime.now().setZone(DEFAULT_TZ);
  const weekStart = now.startOf("week").toUTC().toJSDate();
  const dayStart = now.startOf("day").toUTC().toJSDate();
  const dayEnd = now.endOf("day").toUTC().toJSDate();
  const active = await getFeaturedCompetition();
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

  const [entriesWeek, uniqueWeek, revenueWeek, shotsWeek, bookingsToday, outstanding, pendingHio, newCustomers, fittingEnq] = await Promise.all([
    n(db.select({ n: sql<number>`count(*)::int` }).from(rounds).where(and(gte(rounds.createdAt, weekStart), sql`${rounds.status} not in ('cancelled','voided')`))),
    n(db.select({ n: sql<number>`count(distinct ${rounds.customerId})::int` }).from(rounds).where(and(gte(rounds.createdAt, weekStart), sql`${rounds.status} not in ('cancelled','voided')`))),
    n(db.select({ n: sql<number>`coalesce(sum(${payments.amountPence} - ${payments.refundedPence}),0)::int` }).from(payments).where(and(gte(payments.createdAt, weekStart), inArray(payments.status, ["paid", "paid_in_store", "partially_refunded"])))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(shots).where(and(gte(shots.recordedAt, weekStart), eq(shots.status, "active")))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(gte(bookings.startsAt, dayStart), lt(bookings.startsAt, dayEnd), inArray(bookings.status, ["confirmed", "checked_in", "completed"])))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(rounds).where(inArray(rounds.status, ["in_progress", "paused"]))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(hioClaims).where(eq(hioClaims.status, "pending_review"))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(customers).where(gte(customers.createdAt, weekStart))),
    n(db.select({ n: sql<number>`count(*)::int` }).from(fittingEnquiries).where(gte(fittingEnquiries.createdAt, weekStart))),
  ]);
  const leader = active ? (await getStandings(active))[0] ?? null : null;
  const upcoming = await db
    .select()
    .from(competitions)
    .where(inArray(competitions.status, ["draft", "pending_approval", "scheduled"]))
    .orderBy(asc(competitions.startsAt))
    .limit(5);
  const needsResults = await db.select().from(competitions).where(inArray(competitions.status, ["closed", "awaiting_verification"]));
  return { active, leader, entriesWeek, uniqueWeek, revenueWeek, shotsWeek, bookingsToday, outstanding, pendingHio, newCustomers, fittingEnq, upcoming, needsResults };
}
