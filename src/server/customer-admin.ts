import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, customerConsents, customerNotes, customers, fittingEnquiries, hioClaims, payments, prizeAwards, rounds, shots, users } from "@/db/schema";

export async function listCustomers(opts: { q?: string; filter?: string; limit?: number }) {
  const conds = [isNull(customers.mergedIntoId)];
  if (opts.q && opts.q.trim().length >= 2) {
    const like = `%${opts.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(customers.firstName, like), ilike(customers.lastName, like), ilike(customers.email, like), ilike(customers.mobile, like))!);
  }
  if (opts.filter === "marketing") conds.push(eq(customers.marketingEmailConsent, true));
  if (opts.filter === "fitting") conds.push(eq(customers.fittingInterest, true));
  const rows = await db
    .select({
      c: customers,
      rounds: sql<number>`(select count(*)::int from rounds r where r.customer_id = ${customers.id} and r.status = 'completed')`,
      lastRound: sql<Date | null>`(select max(r.completed_at) from rounds r where r.customer_id = ${customers.id})`,
    })
    .from(customers)
    .where(and(...conds))
    .orderBy(desc(customers.lastActivityAt))
    .limit(opts.limit ?? 100);
  return rows;
}

export async function customerProfile(id: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) return null;
  const rs = await db
    .select({ r: rounds, comp: competitions })
    .from(rounds)
    .innerJoin(competitions, eq(competitions.id, rounds.competitionId))
    .where(eq(rounds.customerId, id))
    .orderBy(desc(rounds.createdAt));
  const ids = rs.map((x) => x.r.id);
  const sh = ids.length ? await db.select().from(shots).where(and(inArray(shots.roundId, ids), eq(shots.status, "active"))) : [];
  const valid = sh.filter((s) => s.valid && s.onGreen && s.distanceMm !== null && !s.isHoleInOne);
  const [consents, notes, pays, awards, claims, enquiries] = await Promise.all([
    db.select().from(customerConsents).where(eq(customerConsents.customerId, id)).orderBy(desc(customerConsents.createdAt)),
    db.select({ n: customerNotes, author: users.name }).from(customerNotes).innerJoin(users, eq(users.id, customerNotes.authorUserId)).where(eq(customerNotes.customerId, id)).orderBy(desc(customerNotes.createdAt)),
    db.select().from(payments).where(eq(payments.customerId, id)).orderBy(desc(payments.createdAt)),
    db.select({ a: prizeAwards, comp: competitions }).from(prizeAwards).innerJoin(competitions, eq(competitions.id, prizeAwards.competitionId)).where(eq(prizeAwards.customerId, id)),
    db.select().from(hioClaims).where(eq(hioClaims.customerId, id)),
    db.select().from(fittingEnquiries).where(eq(fittingEnquiries.customerId, id)).orderBy(desc(fittingEnquiries.createdAt)),
  ]);
  const visits = new Set(rs.filter((x) => x.r.startedAt).map((x) => x.r.startedAt!.toISOString().slice(0, 10))).size;
  const possibleDuplicates = c.mobile
    ? await db.select().from(customers).where(and(eq(customers.mobile, c.mobile), sql`${customers.id} <> ${id}`, isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)))
    : [];
  return {
    c,
    rounds: rs,
    shots: sh,
    consents,
    notes,
    payments: pays,
    awards,
    claims,
    enquiries,
    possibleDuplicates,
    stats: {
      visits,
      rounds: rs.filter((x) => x.r.status === "completed").length,
      shots: sh.length,
      personalBest: valid.length ? Math.min(...valid.map((s) => s.distanceMm!)) : null,
      weeklyWins: awards.filter((a) => a.a.kind === "weekly" && a.a.rank === 1 && a.a.status !== "cancelled").length,
      holeInOnes: claims.filter((h) => h.status === "approved").length,
    },
  };
}
