import { sql } from "drizzle-orm";
import { db } from "@/db";
import { availabilityRules, jackpotFunding, legalApprovals, locations, simulators, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { approveAndSchedule, createCompetition, openCompetition, type CompetitionInput } from "@/server/competitions";

export async function resetDb() {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = tables.rows.map((t) => `"${t.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export type Fixture = Awaited<ReturnType<typeof baseFixture>>;

export async function baseFixture() {
  const [loc] = await db.insert(locations).values({ slug: "ringwood", name: "Evolution Golf Ringwood" }).returning();
  const [sim] = await db.insert(simulators).values({ locationId: loc.id, name: "Bay 1", slotMinutes: 10, slotCapacity: 1 }).returning();
  // Open every day 00:00–23:50 so tests aren't time-of-day dependent.
  await db.insert(availabilityRules).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ simulatorId: sim.id, kind: "opening_hours" as const, weekday, startTime: "00:00", endTime: "23:50" })),
  );
  const mk = async (role: "super_admin" | "manager" | "staff" | "marketing", name: string) =>
    (await db.insert(users).values({ email: `${role}@test.local`, name, role }).returning())[0];
  const admin = await mk("super_admin", "Ada Admin");
  const manager = await mk("manager", "Max Manager");
  const staff = await mk("staff", "Sam Staff");
  const actor = (u: typeof admin): Actor & { type: "user" } => ({ type: "user", id: u.id, label: u.email, role: u.role });
  return { loc, sim, admin, manager, staff, adminActor: actor(admin), managerActor: actor(manager), staffActor: actor(staff) };
}

export async function approveTerms(f: Fixture, termsVersion = "t1", scope: "paid_entry" | "free_promotion" = "free_promotion") {
  await db.insert(legalApprovals).values({ scope, termsVersion, reviewerName: "Test Solicitor", recordedByUserId: f.admin.id });
}

export async function fundJackpot(f: Fixture, coveragePence = 500_000) {
  const [fund] = await db
    .insert(jackpotFunding)
    .values({
      kind: "allocated_funds",
      provider: "Test reserve",
      coverageLimitPence: coveragePence,
      validFrom: new Date(Date.now() - 365 * 86400_000),
      validTo: new Date(Date.now() + 365 * 86400_000),
      coveredFormat: "Simulator closest to pin",
      simulatorCoverageConfirmed: true,
      confirmedByUserId: f.admin.id,
      confirmedAt: new Date(),
    })
    .returning();
  return fund;
}

export function competitionInput(f: Fixture, overrides: Partial<CompetitionInput> = {}): CompetitionInput {
  const now = Date.now();
  return {
    name: "Pin Hunters — Week 1",
    locationId: f.loc.id,
    simulatorId: f.sim.id,
    startsAt: new Date(now - 3600_000),
    endsAt: new Date(now + 6 * 86400_000),
    entryMode: "free",
    entryFeePence: 0,
    shotsPerRound: 5,
    requireOnGreen: true,
    holeName: "Signature Par 3",
    holeDistanceYards: 145,
    tiePolicy: "equal_rank_split",
    tiePolicyText: "Tied players share the combined prizes equally.",
    rulesMarkdown: "Test rules",
    termsVersion: "t1",
    prizes: [{ rank: 1, amountPence: 10_000, description: "£100" }],
    ...overrides,
  };
}

/** Create, approve and open a competition. */
export async function openComp(f: Fixture, overrides: Partial<CompetitionInput> = {}) {
  const input = competitionInput(f, overrides);
  await approveTerms(f, String(input.termsVersion), input.entryMode === "paid" ? "paid_entry" : "free_promotion").catch(() => undefined);
  const c = await createCompetition(input, f.managerActor);
  await approveAndSchedule(c.id, f.managerActor);
  return openCompetition(c.id, f.managerActor);
}

let n = 0;
export function person(overrides: Record<string, unknown> = {}) {
  n++;
  return {
    firstName: `Test${n}`,
    lastName: `Player${n}`,
    email: `player${n}-${Date.now()}@example.com`,
    mobile: `07700 9${String(n).padStart(5, "0")}`,
    acceptTerms: true as const,
    confirmEligibility: true as const,
    marketingEmail: false,
    ...overrides,
  };
}
