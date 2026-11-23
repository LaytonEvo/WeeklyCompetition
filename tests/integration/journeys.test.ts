import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, bookings, competitions, customers, hioClaims, notifications, prizeAwards, rounds, shotEvidence, shots } from "@/db/schema";
import { createBooking } from "@/server/bookings";
import { approveAndSchedule, closeCompetition, createCompetition, publishBlockers, updateCompetition } from "@/server/competitions";
import { findOrCreateCustomer } from "@/server/customers";
import { startOnlineEntry, walkInEntry } from "@/server/entry";
import { reviewClaim } from "@/server/hio";
import { getPublicLeaderboard, getStandings } from "@/server/leaderboard";
import { sendRoundSummary } from "@/server/messages";
import { finaliseCompetition, updatePrize, winnersArchive } from "@/server/results";
import { completeRound, correctShot, recordShot, restartRound, startRound } from "@/server/rounds";
import { schedulerTick } from "@/server/scheduler";
import { approveTerms, baseFixture, competitionInput, fundJackpot, openComp, person, resetDb, type Fixture } from "../helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await baseFixture();
});

const ctx = { source: "test", termsVersion: "t1", privacyNoticeVersion: "p1", marketingNoticeVersion: "m1" };

async function playRound(roundId: string, distances: (number | null)[], opts: { offGreen?: number[] } = {}) {
  await startRound(roundId, f.staffActor);
  for (let i = 0; i < distances.length; i++) {
    await recordShot(roundId, { shotNumber: i + 1, distanceMm: distances[i], onGreen: !(opts.offGreen ?? []).includes(i + 1), valid: distances[i] !== null }, f.staffActor);
  }
  return completeRound(roundId, f.staffActor, distances.length < 5 ? "test early finish" : undefined);
}

async function walkIn(compId: string, who = person(), qty = 1) {
  const r = await walkInEntry({ competitionId: compId, newCustomer: who, roundsQty: qty, method: "free_entry", idempotencyKey: crypto.randomUUID() }, f.staffActor);
  return r;
}

describe("Journey B — walk-in customer", () => {
  it("registers, records five shots, and updates the leaderboard with the best valid shot", async () => {
    const comp = await openComp(f);
    const { rounds: rs } = await walkIn(comp.id, person({ firstName: "James", lastName: "Robinson" }));
    expect(rs).toHaveLength(1);
    expect(rs[0].status).toBe("checked_in");
    await playRound(rs[0].id, [4260, 1340, 900, null, 2000], { offGreen: [3] });
    const board = await getPublicLeaderboard((await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0]);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]).toMatchObject({ rank: 1, name: "James R.", best: "1.34 m" }); // 0.90 m was off the green
    expect(JSON.stringify(board)).not.toMatch(/@|07700|\+44/); // no contact details
  });

  it("is idempotent on retried submissions (no duplicate entries or shots)", async () => {
    const comp = await openComp(f);
    const key = crypto.randomUUID();
    const who = person();
    const a = await walkInEntry({ competitionId: comp.id, newCustomer: who, roundsQty: 1, method: "free_entry", idempotencyKey: key }, f.staffActor);
    const b = await walkInEntry({ competitionId: comp.id, newCustomer: who, roundsQty: 1, method: "free_entry", idempotencyKey: key }, f.staffActor);
    expect(b.duplicate).toBe(true);
    expect(await db.select().from(rounds)).toHaveLength(1);
    const roundId = a.rounds![0].id;
    await startRound(roundId, f.staffActor);
    const s1 = await recordShot(roundId, { shotNumber: 1, distanceMm: 1500, onGreen: true }, f.staffActor);
    const s2 = await recordShot(roundId, { shotNumber: 1, distanceMm: 1500, onGreen: true }, f.staffActor);
    expect(s2.duplicate).toBe(true);
    expect(s2.shot.id).toBe(s1.shot.id);
    await expect(recordShot(roundId, { shotNumber: 1, distanceMm: 1600, onGreen: true }, f.staffActor)).rejects.toThrow(/already recorded/);
    await expect(recordShot(roundId, { shotNumber: 3, distanceMm: 1600, onGreen: true }, f.staffActor)).rejects.toThrow(/Next shot/);
  });

  it("does not create a duplicate customer for a returning email", async () => {
    const who = person();
    const a = await findOrCreateCustomer(db, who, ctx, f.staffActor);
    const b = await findOrCreateCustomer(db, { ...who, email: who.email.toUpperCase(), firstName: "Different" }, ctx, f.staffActor);
    expect(b.created).toBe(false);
    expect(b.customer.id).toBe(a.customer.id);
    expect(b.customer.firstName).toBe(who.firstName); // never overwritten by form data
  });

  it("records marketing consent separately and never by default", async () => {
    const { customer } = await findOrCreateCustomer(db, person(), ctx, f.staffActor);
    expect(customer.marketingEmailConsent).toBe(false);
    const { customer: c2 } = await findOrCreateCustomer(db, person({ marketingEmail: true }), ctx, f.staffActor);
    expect(c2.marketingEmailConsent).toBe(true);
    await expect(findOrCreateCustomer(db, person({ acceptTerms: false }), ctx, f.staffActor)).rejects.toThrow();
  });
});

describe("Journey C — returning customer", () => {
  it("uses the best qualifying result across rounds and shows one row per player", async () => {
    const comp = await openComp(f);
    const who = person({ firstName: "Tom", lastName: "Webb" });
    const first = await walkIn(comp.id, who);
    await playRound(first.rounds![0].id, [3000, 2500, 2800, 4000, 3100]);
    const second = await walkInEntry({ competitionId: comp.id, customerId: first.booking!.customerId!, roundsQty: 1, method: "free_entry", idempotencyKey: crypto.randomUUID() }, f.staffActor);
    await playRound(second.rounds![0].id, [880, 5000, 4000, 3000, 2000]);
    const other = await walkIn(comp.id);
    await playRound(other.rounds![0].id, [1200, 1300, 1400, 1500, 1600]);
    const c = (await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0];
    const board = await getPublicLeaderboard(c);
    expect(board.rows.map((r) => [r.name, r.best, r.rounds])).toEqual([
      ["Tom W.", "0.88 m", 2],
      [expect.any(String), "1.20 m", 1],
    ]);
    // Personal best email
    await sendRoundSummary(second.rounds![0].id);
    const [mail] = await db.select().from(notifications).where(eq(notifications.dedupeKey, `round_summary:${second.rounds![0].id}`));
    expect(mail.type).toBe("round_summary_pb");
    expect(mail.bodyText).toContain("0.88 metres");
  });

  it("enforces maximum rounds per customer", async () => {
    const comp = await openComp(f, { maxRoundsPerCustomer: 1 });
    const first = await walkIn(comp.id);
    await expect(
      walkInEntry({ competitionId: comp.id, customerId: first.booking!.customerId!, roundsQty: 1, method: "free_entry", idempotencyKey: crypto.randomUUID() }, f.staffActor),
    ).rejects.toThrow(/maximum of 1 round/);
  });
});

describe("score corrections", () => {
  it("never overwrites: superseded shots are kept, and verified rounds need elevated permission", async () => {
    const comp = await openComp(f);
    const { rounds: rs } = await walkIn(comp.id);
    await playRound(rs[0].id, [1000, 2000, 3000, 4000, 5000]);
    const [s1] = await db.select().from(shots).where(eq(shots.shotNumber, 1));
    await expect(correctShot(s1.id, { distanceMm: 900, onGreen: true }, "typo", f.staffActor, { canCorrectVerified: false })).rejects.toThrow(/manager/);
    await expect(correctShot(s1.id, { distanceMm: 900, onGreen: true }, "", f.managerActor, { canCorrectVerified: true })).rejects.toThrow(/reason/);
    const replacement = await correctShot(s1.id, { distanceMm: 900, onGreen: true }, "Entered 1.00 instead of 0.90", f.managerActor, { canCorrectVerified: true });
    const all = await db.select().from(shots).where(eq(shots.shotNumber, 1));
    expect(all.map((s) => s.status).sort()).toEqual(["active", "superseded"]);
    expect(replacement!.supersedesShotId).toBe(s1.id);
    const c = (await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0];
    expect((await getStandings(c))[0].bestScore).toBe(900);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "shot.correct_verified"));
    expect(logs).toHaveLength(1);
  });

  it("supports undo of the latest shot in a live round", async () => {
    const comp = await openComp(f);
    const { rounds: rs } = await walkIn(comp.id);
    await startRound(rs[0].id, f.staffActor);
    await recordShot(rs[0].id, { shotNumber: 1, distanceMm: 1000, onGreen: true }, f.staffActor);
    const { shot } = await recordShot(rs[0].id, { shotNumber: 2, distanceMm: 2000, onGreen: true }, f.staffActor);
    await correctShot(shot.id, { remove: true }, "Recorded twice", f.staffActor, { canCorrectVerified: false });
    const again = await recordShot(rs[0].id, { shotNumber: 2, distanceMm: 2100, onGreen: true }, f.staffActor);
    expect(again.duplicate).toBe(false);
  });

  it("restart after simulator failure voids the round and issues a replacement entry", async () => {
    const comp = await openComp(f);
    const { rounds: rs } = await walkIn(comp.id);
    await startRound(rs[0].id, f.staffActor);
    await recordShot(rs[0].id, { shotNumber: 1, distanceMm: 50, onGreen: true }, f.staffActor);
    const replacement = await restartRound(rs[0].id, "Simulator froze", f.staffActor);
    expect(replacement.restartOfRoundId).toBe(rs[0].id);
    const c = (await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0];
    expect(await getStandings(c)).toHaveLength(0); // voided shots never count
  });
});

describe("Journey D — hole-in-one", () => {
  it("requires evidence and independent review, then creates a jackpot award", async () => {
    const fund = await fundJackpot(f);
    const comp = await openComp(f, { jackpotEnabled: true, jackpotAmountPence: 100_000, jackpotMaxWinners: 2, jackpotFundingId: fund.id });
    const { rounds: rs } = await walkIn(comp.id);
    const roundId = rs[0].id;
    await startRound(roundId, f.staffActor);
    await expect(recordShot(roundId, { shotNumber: 1, distanceMm: null, onGreen: true, isHoleInOne: true }, f.staffActor)).rejects.toThrow(/witnessed/);
    await recordShot(roundId, { shotNumber: 1, distanceMm: null, onGreen: true, isHoleInOne: true, hioStatement: "Ball holed on simulator, screen shows HOLE IN ONE" }, f.staffActor);
    for (let i = 2; i <= 5; i++) await recordShot(roundId, { shotNumber: i, distanceMm: 3000, onGreen: true }, f.staffActor);
    await completeRound(roundId, f.staffActor);
    const c = (await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0];
    // Pending claim is not on the public leaderboard as a hole-in-one
    expect((await getStandings(c))[0].bestScore).toBe(3000);

    const [claim] = await db.select().from(hioClaims);
    await expect(reviewClaim(claim.id, "approve", "ok", f.staffActor)).rejects.toThrow(/cannot review their own/);
    await expect(reviewClaim(claim.id, "approve", "ok", f.managerActor)).rejects.toThrow(/evidence/);
    await db.insert(shotEvidence).values({ shotId: claim.shotId, roundId, storageKey: "evidence/x.png", contentType: "image/png", sizeBytes: 10, sha256: "x" });
    const res = await reviewClaim(claim.id, "approve", "Screenshot and witness statement consistent", f.managerActor);
    expect(res.jackpotEligible).toBe(true);
    const standings = await getStandings(c);
    expect(standings[0]).toMatchObject({ bestScore: 0, holeInOne: true });
    const [award] = await db.select().from(prizeAwards).where(eq(prizeAwards.kind, "jackpot"));
    expect(award).toMatchObject({ prizeAmountPence: 100_000, status: "awaiting_claim" });
    await expect(updatePrize(award.id, "fulfilled", { paidAmountPence: 100_000 }, f.managerActor)).rejects.toThrow(/reference/);
    const paid = await updatePrize(award.id, "fulfilled", { paidAmountPence: 100_000, paymentMethod: "Bank transfer", paymentReference: "BACS-123" }, f.managerActor);
    expect(paid.status).toBe("fulfilled");
  });

  it("caps jackpot winners — later hole-in-ones are verified but not paid", async () => {
    const fund = await fundJackpot(f);
    const comp = await openComp(f, { jackpotEnabled: true, jackpotAmountPence: 100_000, jackpotMaxWinners: 1, jackpotFundingId: fund.id });
    const claims = [];
    for (let p = 0; p < 2; p++) {
      const { rounds: rs } = await walkIn(comp.id);
      await startRound(rs[0].id, f.staffActor);
      const { shot } = await recordShot(rs[0].id, { shotNumber: 1, distanceMm: null, onGreen: true, isHoleInOne: true, hioStatement: "holed" }, f.staffActor);
      await completeRound(rs[0].id, f.staffActor, "Hole-in-one, player finished");
      await db.insert(shotEvidence).values({ shotId: shot.id, roundId: rs[0].id, storageKey: `e${p}`, contentType: "image/png", sizeBytes: 1, sha256: "x" });
      claims.push((await db.select().from(hioClaims).where(eq(hioClaims.shotId, shot.id)))[0]);
    }
    expect((await reviewClaim(claims[0].id, "approve", "ok", f.managerActor)).jackpotEligible).toBe(true);
    const second = await reviewClaim(claims[1].id, "approve", "ok", f.managerActor);
    expect(second.jackpotEligible).toBe(false);
    expect(second.ineligibleReason).toMatch(/Maximum of 1/);
    const c = (await db.select().from(competitions).where(eq(competitions.id, comp.id)))[0];
    const st = await getStandings(c);
    expect(st.map((s) => s.rank)).toEqual([1, 1]); // both hole-in-ones tie
  });

  it("will not publish a jackpot that exceeds authorised funding", async () => {
    await approveTerms(f);
    const fund = await fundJackpot(f, 100_000);
    const c = await createCompetition(competitionInput(f, { jackpotEnabled: true, jackpotAmountPence: 100_000, jackpotMaxWinners: 2, jackpotFundingId: fund.id }), f.managerActor);
    const blockers = await publishBlockers(c);
    expect(blockers.join(" ")).toMatch(/exceeds the funding/);
    await expect(approveAndSchedule(c.id, f.managerActor)).rejects.toThrow(/Cannot publish/);
  });
});

describe("Journey E — closure and finalisation", () => {
  it("closes at the deadline, blocks finalisation on outstanding work, and records winners once", async () => {
    const comp = await openComp(f, { endsAt: new Date(Date.now() + 60 * 60_000), prizes: [{ rank: 1, amountPence: 10_000, description: "£100" }] });
    const a = await walkIn(comp.id, person({ firstName: "Chris", lastName: "Moss" }));
    await playRound(a.rounds![0].id, [1240, 3000, 3000, 3000, 3000]);
    const b = await walkIn(comp.id);
    await startRound(b.rounds![0].id, f.staffActor); // still in progress at the deadline
    await recordShot(b.rounds![0].id, { shotNumber: 1, distanceMm: 420, onGreen: true }, f.staffActor);

    // Deadline passes
    await db.update(competitions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(competitions.id, comp.id));
    const log = await schedulerTick();
    expect(log.join()).toMatch(/closed/);
    let [c] = await db.select().from(competitions).where(eq(competitions.id, comp.id));
    expect(c.status).toBe("awaiting_verification");
    await schedulerTick(); // idempotent
    await expect(finaliseCompetition(comp.id, f.managerActor)).rejects.toThrow(/unfinished round/);
    // New rounds can't start after the deadline, but a round started in time can finish.
    const late = await walkIn(comp.id).catch((e) => e);
    expect(String(late)).toMatch(/open/);
    for (let i = 2; i <= 5; i++) await recordShot(b.rounds![0].id, { shotNumber: i, distanceMm: 5000, onGreen: true }, f.staffActor);
    await completeRound(b.rounds![0].id, f.staffActor);

    const res = await finaliseCompetition(comp.id, f.managerActor);
    expect(res.awards).toHaveLength(1);
    expect(res.awards[0]).toMatchObject({ rank: 1, distanceMm: 420, prizeAmountPence: 10_000, status: "awaiting_claim" });
    const again = await finaliseCompetition(comp.id, f.managerActor);
    expect(again.alreadyFinalised).toBe(true);
    expect(await db.select().from(prizeAwards)).toHaveLength(1);
    [c] = await db.select().from(competitions).where(eq(competitions.id, comp.id));
    expect(c.status).toBe("finalised");
    expect((await winnersArchive()).length).toBe(1);
  });

  it("splits prizes for ties under the published policy", async () => {
    const comp = await openComp(f, { prizes: [{ rank: 1, amountPence: 10_000, description: "£100" }, { rank: 2, amountPence: 5_000, description: "£50" }] });
    for (let i = 0; i < 2; i++) {
      const { rounds: rs } = await walkIn(comp.id);
      await playRound(rs[0].id, [700, 2000, 2000, 2000, 2000]);
    }
    await closeCompetition(comp.id, f.managerActor);
    const res = await finaliseCompetition(comp.id, f.managerActor);
    expect(res.awards.map((a) => [a.rank, a.prizeAmountPence, a.splitWays])).toEqual([
      [1, 7_500, 2],
      [1, 7_500, 2],
    ]);
  });
});

describe("rule changes after opening", () => {
  it("blocks outcome-changing edits and audits permitted material changes", async () => {
    const comp = await openComp(f);
    const input = competitionInput(f, { startsAt: comp.startsAt, endsAt: comp.endsAt });
    await expect(updateCompetition(comp.id, { ...input, tiePolicy: "countback" }, f.managerActor, "change")).rejects.toThrow(/cannot change/);
    await expect(updateCompetition(comp.id, { ...input, prizes: [{ rank: 1, amountPence: 5_000, description: "£50" }] }, f.managerActor, "cut")).rejects.toThrow(/cannot be reduced/);
    await expect(updateCompetition(comp.id, { ...input, prizes: [{ rank: 1, amountPence: 15_000, description: "£150" }] }, f.managerActor)).rejects.toThrow(/reason/);
    const res = await updateCompetition(comp.id, { ...input, prizes: [{ rank: 1, amountPence: 15_000, description: "£150" }] }, f.managerActor, "Sponsor top-up");
    expect(res.materialChange).toBe(true);
  });
});

describe("launch gate", () => {
  it("paid competitions cannot be published without a recorded legal approval", async () => {
    const c = await createCompetition(competitionInput(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" }), f.managerActor);
    expect((await publishBlockers(c)).join(" ")).toMatch(/Paid entry is locked/);
    await approveTerms(f, "paid-v1", "free_promotion"); // wrong scope doesn't unlock
    expect((await publishBlockers(c)).join(" ")).toMatch(/Paid entry is locked/);
    await approveTerms(f, "paid-v1", "paid_entry");
    expect(await publishBlockers(c)).toEqual([]);
  });

  it("online paid entry refuses to start without Stripe configured", async () => {
    await approveTerms(f, "paid-v1", "paid_entry");
    const c = await createCompetition(competitionInput(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" }), f.managerActor);
    await approveAndSchedule(c.id, f.managerActor);
    await expect(
      startOnlineEntry({ competitionId: c.id, startsAt: new Date(), roundsQty: 1, registration: person(), idempotencyKey: crypto.randomUUID() }),
    ).rejects.toThrow(/Online payment isn't available/);
  });
});

describe("online booking (free mode)", () => {
  it("books a slot, confirms, creates rounds, and sends a confirmation email", async () => {
    const comp = await openComp(f);
    const start = new Date(Math.ceil((Date.now() + 2 * 3600_000) / 600_000) * 600_000);
    const res = await startOnlineEntry({ competitionId: comp.id, startsAt: start, roundsQty: 2, registration: person(), idempotencyKey: crypto.randomUUID(), attribution: { utmSource: "facebook", utmCampaign: "launch" } });
    expect(res.checkoutUrl).toBeNull();
    const [b] = await db.select().from(bookings).where(eq(bookings.checkinCode, res.bookingCode));
    expect(b.status).toBe("confirmed");
    expect(b.utmSource).toBe("facebook");
    expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(20 * 60_000);
    expect(await db.select().from(rounds).where(eq(rounds.bookingId, b.id))).toHaveLength(2);
    const [cust] = await db.select().from(customers).where(eq(customers.id, b.customerId!));
    expect(cust.utmSource).toBe("facebook");
    const mails = await db.select().from(notifications).where(eq(notifications.type, "booking_confirmation"));
    expect(mails).toHaveLength(1);
    expect(mails[0].status).toBe("sent");
  });

  it("rejects slots outside opening rules unless a staff override is used", async () => {
    const comp = await openComp(f);
    const odd = new Date(Math.ceil((Date.now() + 2 * 3600_000) / 600_000) * 600_000 + 3 * 60_000); // not on a slot boundary
    await expect(createBooking(db, { competitionId: comp.id, customerId: null, startsAt: odd, roundsQty: 1, source: "online", status: "confirmed" }, f.staffActor)).rejects.toThrow(/isn't offered/);
    const ok = await createBooking(db, { competitionId: comp.id, customerId: null, startsAt: odd, roundsQty: 1, source: "staff", status: "confirmed", overrideAvailability: true }, f.managerActor);
    expect(ok.overrideByUserId).toBe(f.manager.id);
  });
});
