import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, competitions, competitionTemplates, customers, notifications, rounds, type CompetitionConfig } from "@/db/schema";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { autoCreateFromTemplates } from "@/server/competitions";
import { anonymiseCustomer, exportCustomerData, findOrCreateCustomer, mergeCustomers } from "@/server/customers";
import { walkInEntry } from "@/server/entry";
import { getPublicLeaderboard } from "@/server/leaderboard";
import { queueEmail } from "@/server/notifications";
import { computeReport } from "@/server/reports";
import { completeRound, recordShot, startRound } from "@/server/rounds";
import { baseFixture, openComp, person, resetDb, type Fixture } from "../helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await baseFixture();
});
const ctx = { source: "test", termsVersion: "t1", privacyNoticeVersion: "p1", marketingNoticeVersion: "m1" };

describe("weekly scheduling", () => {
  it("drafts upcoming weeks from a template exactly once, however often the scheduler runs", async () => {
    const config: CompetitionConfig = {
      format: "closest_to_pin", description: "", entryMode: "free", entryFeePence: 0, shotsPerRound: 5, durationDays: 7, startWeekday: 1, startTime: "09:00", endTime: "18:00",
      prizes: [{ rank: 1, amountPence: 10000, description: "£100" }], jackpotEnabled: false, jackpotAmountPence: 0, jackpotMaxWinners: null, jackpotMaxPerPlayer: 1, jackpotMaxLiabilityPence: null,
      jackpotSubsequentQualify: true, hioCountsForWeekly: true, jackpotClaimDays: 30, requireOnGreen: true, holeName: "7th", holeDistanceYards: 140, simulatorSettings: "", eligibility: "",
      maxEntrants: null, maxRoundsPerCustomer: null, tiePolicy: "equal_rank_split", tiePolicyText: "Ties share", rulesMarkdown: "rules", termsVersion: "t1", showRoundsCount: true,
    };
    await db.insert(competitionTemplates).values({ name: "Weekly", locationId: f.loc.id, simulatorId: f.sim.id, config, autoCreateWeekly: true });
    await Promise.all([autoCreateFromTemplates(SYSTEM_ACTOR), autoCreateFromTemplates(SYSTEM_ACTOR)]);
    await autoCreateFromTemplates(SYSTEM_ACTOR);
    const rows = await db.select().from(competitions);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "draft")).toBe(true); // still need human approval
    expect(new Set(rows.map((r) => r.sequence))).toEqual(new Set([1, 2]));
  });
});

describe("customer data", () => {
  it("merges duplicates, re-pointing history, and keeps one leaderboard row", async () => {
    const comp = await openComp(f);
    const a = await findOrCreateCustomer(db, person({ firstName: "Dan", lastName: "Dup", mobile: "07700 955955" }), ctx, f.staffActor);
    const b = await findOrCreateCustomer(db, person({ firstName: "Daniel", lastName: "Dup", mobile: "07700 955955" }), ctx, f.staffActor);
    expect(b.possibleDuplicateIds).toContain(a.customer.id);
    for (const [cust, d] of [[a.customer, 2000], [b.customer, 900]] as const) {
      const e = await walkInEntry({ competitionId: comp.id, customerId: cust.id, roundsQty: 1, method: "free_entry", idempotencyKey: crypto.randomUUID() }, f.staffActor);
      await startRound(e.rounds![0].id, f.staffActor);
      await recordShot(e.rounds![0].id, { shotNumber: 1, distanceMm: d, onGreen: true }, f.staffActor);
      await completeRound(e.rounds![0].id, f.staffActor, "test");
    }
    await mergeCustomers(b.customer.id, a.customer.id, f.managerActor, "Same person, two emails");
    expect(await db.select().from(rounds).where(eq(rounds.customerId, a.customer.id))).toHaveLength(2);
    const [c] = await db.select().from(competitions).where(eq(competitions.id, comp.id));
    const board = await getPublicLeaderboard(c);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].bestMm).toBe(900);
  });

  it("exports everything held and erases personal data while keeping anonymous results", async () => {
    const comp = await openComp(f);
    const e = await walkInEntry({ competitionId: comp.id, newCustomer: person({ firstName: "Erin", lastName: "Erase" }), roundsQty: 1, method: "free_entry", idempotencyKey: crypto.randomUUID() }, f.staffActor);
    await startRound(e.rounds![0].id, f.staffActor);
    await recordShot(e.rounds![0].id, { shotNumber: 1, distanceMm: 1500, onGreen: true }, f.staffActor);
    await completeRound(e.rounds![0].id, f.staffActor, "test");
    const id = e.booking!.customerId!;
    const data = await exportCustomerData(id);
    expect(data.profile.firstName).toBe("Erin");
    expect(data.consents.length).toBeGreaterThan(0);
    expect(data.shots).toHaveLength(1);
    await anonymiseCustomer(id, f.adminActor, "Erasure request #1");
    const [after] = await db.select().from(customers).where(eq(customers.id, id));
    expect(after.firstName).toBe("Former");
    expect(after.mobile).toBe("");
    const [c] = await db.select().from(competitions).where(eq(competitions.id, comp.id));
    const board = await getPublicLeaderboard(c);
    expect(board.rows[0]).toMatchObject({ name: "Former player", bestMm: 1500 });
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "customer.anonymise"))).length).toBe(1);
  });
});

describe("communications", () => {
  it("never sends the same message twice for the same event", async () => {
    const content = { subject: "x", heading: "x", blocks: [{ p: "hello" }] };
    const first = await queueEmail({ type: "t", customerId: null, to: "a@example.com", content, dedupeKey: "same-key" });
    const second = await queueEmail({ type: "t", customerId: null, to: "a@example.com", content, dedupeKey: "same-key" });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("escapes user-controlled content in email HTML", async () => {
    await queueEmail({ type: "t", customerId: null, to: "a@example.com", content: { subject: "x", heading: "x", greeting: "Hi <script>alert(1)</script>", blocks: [] }, dedupeKey: "xss" });
    const [n] = await db.select().from(notifications).where(eq(notifications.dedupeKey, "xss"));
    expect(n.bodyHtml).not.toContain("<script>");
    expect(n.bodyHtml).toContain("&lt;script&gt;");
  });
});

describe("reporting", () => {
  it("separates gross revenue from refunds and labels unavailable metrics", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    await walkInEntry({ competitionId: comp.id, newCustomer: person(), roundsQty: 2, method: "cash", amountPence: 1000, idempotencyKey: crypto.randomUUID() }, f.staffActor);
    const m = await computeReport({ from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000) }, 90);
    const get = (k: string) => m.find((x) => x.key === k)!;
    expect(get("entries").value).toBe(2);
    expect(get("unique").value).toBe(1);
    expect(get("gross").value).toBe(1000);
    expect(get("gross").note).toMatch(/not profit/);
    expect(get("cac").basis).toBe("unavailable");
  });
});
