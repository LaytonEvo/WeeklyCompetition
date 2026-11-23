/**
 * E2E fixture: on top of the dev seed, add a second simulator bay running a
 * FREE-entry competition that is bookable all day, so the online booking
 * journey can be exercised without Stripe credentials.
 */
import "dotenv/config";
import { db, getPool } from "@/db";
import { availabilityRules, locations, simulators, users } from "@/db/schema";
import { approveAndSchedule, createCompetition, openCompetition } from "@/server/competitions";

async function main() {
  if (!process.env.DATABASE_URL?.includes("e2e")) throw new Error("e2e-setup must run against an *_e2e database");
  const [loc] = await db.select().from(locations);
  const [mgr] = (await db.select().from(users)).filter((u) => u.role === "manager");
  const [bay2] = await db.insert(simulators).values({ locationId: loc.id, name: "Bay 2 (E2E)", slotMinutes: 10 }).returning();
  await db.insert(availabilityRules).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ simulatorId: bay2.id, kind: "opening_hours" as const, weekday, startTime: "00:00", endTime: "23:50" })));
  const actor = { type: "user" as const, id: mgr.id, label: mgr.email, role: mgr.role };
  const c = await createCompetition(
    {
      name: "E2E Free Challenge",
      locationId: loc.id,
      simulatorId: bay2.id,
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 5 * 86400_000),
      entryMode: "free",
      entryFeePence: 0,
      shotsPerRound: 5,
      tiePolicy: "equal_rank_split",
      tiePolicyText: "Ties share.",
      rulesMarkdown: "# E2E rules",
      termsVersion: "dev-terms-1",
      holeName: "E2E 5th",
      prizes: [{ rank: 1, amountPence: 2500, description: "£25 voucher" }],
    },
    actor,
  );
  await approveAndSchedule(c.id, actor);
  await openCompetition(c.id, actor);
  console.log(`E2E competition ${c.slug}`);
  await getPool().end();
}
main().catch(async (e) => {
  console.error(e);
  await getPool().end();
  process.exit(1);
});
