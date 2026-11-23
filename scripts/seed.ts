/**
 * DEVELOPMENT SEED — fictional data only. Refuses to run in production.
 *   pnpm db:seed
 * Wipes the target database's application tables first.
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, getPool } from "@/db";
import {
  availabilityRules,
  blockedPeriods,
  competitions,
  competitionTemplates,
  customers,
  jackpotFunding,
  legalApprovals,
  locations,
  rounds,
  shots,
  simulators,
  users,
  type CompetitionConfig,
} from "@/db/schema";
import { SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { hashPassword } from "@/lib/crypto";
import { DRAFT_RULES_MD, DRAFT_PRIVACY_MD, DRAFT_TERMS_MD } from "@/lib/legal-drafts";
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/settings";
import { DEFAULT_TZ } from "@/lib/time";
import { approveAndSchedule, closeCompetition, createCompetition, inputFromTemplate, openCompetition } from "@/server/competitions";
import { findOrCreateCustomer } from "@/server/customers";
import { walkInEntry } from "@/server/entry";
import { finaliseCompetition } from "@/server/results";
import { completeRound, recordShot, startRound } from "@/server/rounds";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed a production environment.");
  process.exit(1);
}

const DEV_PASSWORD = "pinhunters-dev";
const TERMS = "dev-terms-1";

const FIRST = ["James", "Tom", "Chris", "Steve", "Oliver", "Harry", "Jack", "Ellie", "Sophie", "Dan", "Matt", "Rob", "Gary", "Paul", "Lucy", "Amir", "Ravi", "Will", "Ben", "Kate", "Nick", "Sam", "Joe", "Mark", "Pete"];
const LAST = ["Robinson", "Walker", "Mason", "Parker", "Hughes", "Bennett", "Carter", "Dawson", "Ellis", "Foster", "Grant", "Hayes", "Irwin", "Jarvis", "Knight", "Lowe", "Morris", "Norton", "Owens", "Price", "Quinn", "Reed", "Shaw", "Turner", "Vaughan"];

/** Deterministic pseudo-random so the seed is reproducible. */
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const distance = () => Math.round(300 + Math.pow(rand(), 1.7) * 14000);

async function main() {
  console.log("Seeding development data (fictional)…");
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname='public'`);
  await db.execute(sql.raw(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(",")} restart identity cascade`));

  const pw = await hashPassword(DEV_PASSWORD);
  const [admin] = await db.insert(users).values({ email: "admin@evolutiongolf.test", name: "Alex Admin", role: "super_admin", passwordHash: pw }).returning();
  const [manager] = await db.insert(users).values({ email: "manager@evolutiongolf.test", name: "Morgan Manager", role: "manager", passwordHash: pw }).returning();
  const [staff] = await db.insert(users).values({ email: "staff@evolutiongolf.test", name: "Sam Staff", role: "staff", passwordHash: pw }).returning();
  await db.insert(users).values({ email: "marketing@evolutiongolf.test", name: "Mia Marketing", role: "marketing", passwordHash: pw });
  const A = (u: typeof admin): Actor & { type: "user" } => ({ type: "user", id: u.id, label: u.email, role: u.role });

  await saveSettings(
    {
      ...DEFAULT_SETTINGS,
      store: { ...DEFAULT_SETTINGS.store, addressLines: "Ringwood, Hampshire", phone: "01425 000000 (placeholder)", email: "hello@evolutiongolf.test", openingHoursText: "Mon–Sat 9:00–17:30 · Sun 10:00–16:00" },
      links: { ...DEFAULT_SETTINGS.links, fittingBookingUrl: "https://example.com/evolution-golf/book-a-fitting" },
      legalTexts: { termsVersion: TERMS, termsMarkdown: DRAFT_TERMS_MD, privacyMarkdown: DRAFT_PRIVACY_MD },
    },
    admin.id,
  );

  const [loc] = await db.insert(locations).values({ slug: "ringwood", name: "Evolution Golf Ringwood", addressLines: "Ringwood, Hampshire" }).returning();
  const [sim] = await db.insert(simulators).values({ locationId: loc.id, name: "Simulator Bay", slotMinutes: 10, slotCapacity: 1 }).returning();
  const open = [1, 2, 3, 4, 5, 6].map((d) => ({ simulatorId: sim.id, kind: "opening_hours" as const, weekday: d, startTime: "09:00", endTime: "17:30" }));
  open.push({ simulatorId: sim.id, kind: "opening_hours", weekday: 7, startTime: "10:00", endTime: "16:00" });
  const windows = [1, 2, 3, 4, 5].map((d) => ({ simulatorId: sim.id, kind: "competition_window" as const, weekday: d, startTime: "11:00", endTime: "17:30" }));
  windows.push({ simulatorId: sim.id, kind: "competition_window", weekday: 6, startTime: "09:00", endTime: "17:30" });
  windows.push({ simulatorId: sim.id, kind: "competition_window", weekday: 7, startTime: "10:00", endTime: "16:00" });
  await db.insert(availabilityRules).values([...open, ...windows]);
  await db.insert(blockedPeriods).values([
    { simulatorId: sim.id, kind: "fitting", title: "Driver fitting block", recurringWeekday: 2, recurringStart: "14:00", recurringEnd: "15:30", createdByUserId: manager.id },
    { simulatorId: sim.id, kind: "fitting", title: "Iron fitting block", recurringWeekday: 4, recurringStart: "15:00", recurringEnd: "16:30", createdByUserId: manager.id },
  ]);

  // DEV-ONLY approvals so the full flow can be exercised locally. NOT a legal review.
  for (const scope of ["paid_entry", "free_promotion"] as const) {
    await db.insert(legalApprovals).values({ scope, termsVersion: TERMS, reviewerName: "DEVELOPMENT SEED — NOT A REAL LEGAL REVIEW", notes: "Created by scripts/seed.ts for local testing only.", recordedByUserId: admin.id });
  }
  const [fund] = await db
    .insert(jackpotFunding)
    .values({
      kind: "allocated_funds",
      provider: "DEV — fictional ring-fenced reserve",
      coverageLimitPence: 300_000,
      perEventLimitPence: 100_000,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: new Date("2027-12-31T00:00:00Z"),
      coveredFormat: "Simulator closest-to-the-pin, single featured par 3",
      evidenceRequirements: "Simulator screenshot + staff witness statement",
      simulatorCoverageConfirmed: true,
      confirmedByUserId: admin.id,
      confirmedAt: new Date(),
    })
    .returning();

  const config: CompetitionConfig = {
    format: "closest_to_pin",
    description: "Five shots at this week's featured par 3. Your closest valid shot goes on the leaderboard.",
    entryMode: "paid",
    entryFeePence: 500,
    shotsPerRound: 5,
    durationDays: 7,
    startWeekday: 1,
    startTime: "09:00",
    endTime: "18:00",
    prizes: [{ rank: 1, amountPence: 10_000, description: "£100 cash prize" }],
    jackpotEnabled: true,
    jackpotAmountPence: 100_000,
    jackpotMaxWinners: 2,
    jackpotMaxPerPlayer: 1,
    jackpotMaxLiabilityPence: 200_000,
    jackpotSubsequentQualify: true,
    hioCountsForWeekly: true,
    jackpotClaimDays: 30,
    requireOnGreen: true,
    holeName: "The Island 7th",
    holeDistanceYards: 142,
    simulatorSettings: "Green speed: medium-fast (11). Wind: off. Pin: middle. Tee: medal.",
    eligibility: "18+. Must be present in store.",
    maxEntrants: null,
    maxRoundsPerCustomer: 10,
    tiePolicy: "equal_rank_split",
    tiePolicyText: "Players with exactly equal closest shots (to the millimetre) share the position and share the prize money for the positions they occupy equally.",
    rulesMarkdown: DRAFT_RULES_MD,
    termsVersion: TERMS,
    showRoundsCount: true,
    jackpotFundingId: fund.id,
  };
  const [tpl] = await db.insert(competitionTemplates).values({ name: "Weekly Pin Hunters", locationId: loc.id, simulatorId: sim.id, config, autoCreateWeekly: true, nextSequence: 1 }).returning();

  const thisMonday = DateTime.now().setZone(DEFAULT_TZ).startOf("week");
  const lastMonday = thisMonday.minus({ weeks: 1 });

  // ---------- Week 1 (last week): finalised history ----------
  const w1 = await createCompetition({ ...inputFromTemplate({ ...tpl, nextSequence: 1 }, lastMonday.toISODate()!), holeName: "The Long 3rd", holeDistanceYards: 168, jackpotFundingId: fund.id }, A(manager), { templateId: tpl.id, sequence: 1 });
  // Bypass "end in the past" publication check for historical seed data
  await db.update(competitions).set({ status: "closed", publishedAt: lastMonday.toJSDate(), openedAt: lastMonday.toJSDate(), closedAt: thisMonday.toJSDate(), approvedByUserId: manager.id }).where(eq(competitions.id, w1.id));
  const players: (typeof customers.$inferSelect)[] = [];
  for (let i = 0; i < 25; i++) {
    const { customer } = await findOrCreateCustomer(
      db,
      {
        firstName: FIRST[i],
        lastName: LAST[(i * 7) % LAST.length],
        email: `${FIRST[i].toLowerCase()}.${LAST[(i * 7) % LAST.length].toLowerCase()}@example.com`,
        mobile: `07700 9${String(i).padStart(5, "0")}`,
        acceptTerms: true,
        confirmEligibility: true,
        marketingEmail: i % 3 === 0,
        publication: i % 4 === 0,
        handicap: String(Math.round(rand() * 28)),
      },
      { source: "seed", termsVersion: TERMS, privacyNoticeVersion: "privacy-draft-1", marketingNoticeVersion: "marketing-draft-1" },
      SYSTEM_ACTOR,
      { acquisitionSource: ["facebook", "instagram", "google", "walk_in", "qr_poster"][i % 5], utmSource: ["facebook", "instagram", "google", null, "qr"][i % 5] },
    );
    players.push(customer);
  }
  for (let i = 0; i < 16; i++) {
    const p = players[i];
    const nRounds = 1 + Math.floor(rand() * 2);
    for (let r = 0; r < nRounds; r++) {
      const when = lastMonday.plus({ days: Math.floor(rand() * 6), hours: 11 + Math.floor(rand() * 6) }).toJSDate();
      const [round] = await db.insert(rounds).values({ competitionId: w1.id, customerId: p.id, shotsAllowed: 5, status: "completed", startedAt: when, completedAt: when, supervisedByUserId: staff.id, verifiedByUserId: staff.id }).returning();
      await db.insert(shots).values(
        Array.from({ length: 5 }, (_, k) => ({ roundId: round.id, shotNumber: k + 1, distanceMm: distance(), onGreen: rand() > 0.2, valid: true, recordedAt: new Date(when.getTime() + k * 60_000), recordedByUserId: staff.id })),
      );
    }
  }
  await closeCompetition(w1.id, SYSTEM_ACTOR).catch(() => undefined);
  await db.update(competitions).set({ status: "closed" }).where(eq(competitions.id, w1.id));
  await finaliseCompetition(w1.id, A(manager), { notes: "Seed data" });

  // ---------- Week 2 (this week): open, live leaderboard ----------
  const w2 = await createCompetition({ ...inputFromTemplate({ ...tpl, nextSequence: 2 }, thisMonday.toISODate()!), jackpotFundingId: fund.id }, A(manager), { templateId: tpl.id, sequence: 2 });
  await db.update(competitionTemplates).set({ nextSequence: 3 }).where(eq(competitionTemplates.id, tpl.id));
  await approveAndSchedule(w2.id, A(manager));
  await openCompetition(w2.id, A(manager));
  // Allow seed rounds regardless of current time-of-day by temporarily overriding availability.
  for (let i = 4; i < 22; i++) {
    const p = players[i];
    const entry = await walkInEntry({ competitionId: w2.id, customerId: p.id, roundsQty: 1, method: i % 4 === 0 ? "cash" : "card_terminal", amountPence: 500, reference: `SEED-${i}`, overrideAvailability: true, startsAt: new Date(Date.now() - (22 - i) * 11 * 60_000 - 3600_000), idempotencyKey: `seed-w2-${i}` }, A(staff));
    const roundId = entry.rounds![0].id;
    await startRound(roundId, A(staff));
    for (let k = 1; k <= 5; k++) await recordShot(roundId, { shotNumber: k, distanceMm: distance(), onGreen: rand() > 0.2, valid: true }, A(staff));
    await completeRound(roundId, A(staff));
  }
  // One pending hole-in-one claim awaiting manager review
  const hioEntry = await walkInEntry({ competitionId: w2.id, customerId: players[22].id, roundsQty: 1, method: "card_terminal", amountPence: 500, reference: "SEED-HIO", overrideAvailability: true, startsAt: new Date(Date.now() - 30 * 60_000), idempotencyKey: "seed-w2-hio" }, A(staff));
  const hr = hioEntry.rounds![0].id;
  await startRound(hr, A(staff));
  await recordShot(hr, { shotNumber: 1, distanceMm: 2400, onGreen: true }, A(staff));
  await recordShot(hr, { shotNumber: 2, distanceMm: null, onGreen: true, isHoleInOne: true, hioStatement: "Ball pitched short and rolled in. Simulator showed HOLE IN ONE banner. Witnessed by Sam at the counter." }, A(staff));
  for (let k = 3; k <= 5; k++) await recordShot(hr, { shotNumber: k, distanceMm: distance(), onGreen: true }, A(staff));
  await completeRound(hr, A(staff));

  // ---------- Week 3: next week's draft from the template ----------
  const nextMonday = thisMonday.plus({ weeks: 1 });
  await createCompetition({ ...inputFromTemplate({ ...tpl, nextSequence: 3 }, nextMonday.toISODate()!), jackpotFundingId: fund.id }, A(manager), { templateId: tpl.id, sequence: 3 });
  await db.update(competitionTemplates).set({ nextSequence: 4 }).where(eq(competitionTemplates.id, tpl.id));

  console.log(`
Done. Fictional development data only.
  Staff logins (password: ${DEV_PASSWORD}):
    admin@evolutiongolf.test   (Super Admin)
    manager@evolutiongolf.test (Manager)
    staff@evolutiongolf.test   (Staff)
    marketing@evolutiongolf.test (Marketing)
  Legal approvals for "${TERMS}" are DEV placeholders — revoke/replace before any real launch.
`);
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e);
  await getPool().end();
  process.exit(1);
});
