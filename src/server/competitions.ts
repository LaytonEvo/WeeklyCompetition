import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  competitionRuleVersions,
  competitions,
  competitionTemplates,
  hioClaims,
  jackpotFunding,
  locations,
  prizeDefinitions,
  rounds,
  type CompetitionConfig,
} from "@/db/schema";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { bumpLeaderboard } from "@/lib/realtime";
import { FORMAT_AVAILABILITY } from "@/lib/scoring/strategies";
import { validateJackpotFunding } from "@/lib/scoring/jackpot";
import { competitionWindow, DEFAULT_TZ } from "@/lib/time";
import { isLaunchApproved, scopeForMode } from "./legal";

export type Competition = typeof competitions.$inferSelect;
export type CompetitionStatus = Competition["status"];

/** Statuses visible on public pages. */
export const PUBLIC_STATUSES: CompetitionStatus[] = ["scheduled", "open", "closed", "awaiting_verification", "finalised", "archived"];

/** Allowed lifecycle transitions — anything else is rejected. */
export const TRANSITIONS: Record<CompetitionStatus, CompetitionStatus[]> = {
  draft: ["pending_approval", "scheduled", "cancelled"],
  pending_approval: ["draft", "scheduled", "cancelled"],
  scheduled: ["open", "draft", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["awaiting_verification", "finalised", "cancelled"],
  awaiting_verification: ["closed", "finalised", "cancelled"],
  finalised: ["archived"],
  archived: [],
  cancelled: [],
};

export function assertTransition(from: CompetitionStatus, to: CompetitionStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`A competition cannot move from "${from.replaceAll("_", " ")}" to "${to.replaceAll("_", " ")}".`);
  }
}

const prizeSchema = z.object({
  rank: z.number().int().min(1).max(50),
  amountPence: z.number().int().min(0).max(100_000_00),
  description: z.string().max(200).default(""),
});

export const competitionInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().max(2000).default(""),
    format: z.enum(["closest_to_pin", "longest_drive", "putting_challenge"]).default("closest_to_pin"),
    locationId: z.string().uuid(),
    simulatorId: z.string().uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    entryMode: z.enum(["paid", "free"]),
    entryFeePence: z.number().int().min(0).max(100_00),
    shotsPerRound: z.number().int().min(1).max(20),
    maxEntrants: z.number().int().min(1).nullable().default(null),
    maxRoundsPerCustomer: z.number().int().min(1).nullable().default(null),
    requireOnGreen: z.boolean().default(true),
    holeName: z.string().max(120).default(""),
    holeDistanceYards: z.number().int().min(10).max(700).nullable().default(null),
    simulatorSettings: z.string().max(2000).default(""),
    eligibility: z.string().max(2000).default(""),
    tiePolicy: z.enum(["equal_rank_split", "countback", "playoff"]).default("equal_rank_split"),
    tiePolicyText: z.string().max(2000).default(""),
    rulesMarkdown: z.string().max(50_000).default(""),
    termsVersion: z.string().trim().min(1).max(32),
    promoImageUrl: z.string().url().nullable().or(z.literal("")).default(null),
    showRoundsCount: z.boolean().default(true),
    jackpotEnabled: z.boolean().default(false),
    jackpotAmountPence: z.number().int().min(0).max(1_000_000_00).default(0),
    jackpotMaxWinners: z.number().int().min(1).nullable().default(null),
    jackpotMaxPerPlayer: z.number().int().min(1).default(1),
    jackpotMaxLiabilityPence: z.number().int().min(0).nullable().default(null),
    jackpotSubsequentQualify: z.boolean().default(true),
    hioCountsForWeekly: z.boolean().default(true),
    jackpotClaimDays: z.number().int().min(1).max(365).default(30),
    jackpotFundingId: z.string().uuid().nullable().default(null),
    prizes: z.array(prizeSchema).max(20).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
    if (v.entryMode === "paid" && v.entryFeePence <= 0) ctx.addIssue({ code: "custom", path: ["entryFeePence"], message: "Paid competitions need an entry fee" });
    if (v.entryMode === "free" && v.entryFeePence !== 0) ctx.addIssue({ code: "custom", path: ["entryFeePence"], message: "Free-entry competitions cannot have an entry fee" });
    if (!FORMAT_AVAILABILITY[v.format]) ctx.addIssue({ code: "custom", path: ["format"], message: "This competition format is not yet available" });
    const ranks = v.prizes.map((p) => p.rank);
    if (new Set(ranks).size !== ranks.length) ctx.addIssue({ code: "custom", path: ["prizes"], message: "Each prize position must be unique" });
  });
export type CompetitionInput = z.input<typeof competitionInputSchema>;

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function uniqueSlug(tx: DbOrTx, name: string, startsAt: Date) {
  const base = `${slugify(name)}-${DateTime.fromJSDate(startsAt, { zone: DEFAULT_TZ }).toFormat("yyyyLLdd")}`;
  let slug = base;
  for (let i = 2; ; i++) {
    const [hit] = await tx.select({ id: competitions.id }).from(competitions).where(eq(competitions.slug, slug));
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

export async function getCompetition(id: string, tx: DbOrTx = db) {
  const [c] = await tx.select().from(competitions).where(eq(competitions.id, id));
  if (!c) throw new NotFoundError("Competition");
  return c;
}

export async function getCompetitionBySlug(slug: string) {
  const [c] = await db.select().from(competitions).where(eq(competitions.slug, slug));
  return c ?? null;
}

export async function getPrizes(competitionId: string, tx: DbOrTx = db) {
  return tx.select().from(prizeDefinitions).where(eq(prizeDefinitions.competitionId, competitionId)).orderBy(asc(prizeDefinitions.rank));
}

export async function createCompetition(input: CompetitionInput, actor: Actor, opts: { templateId?: string; sequence?: number } = {}, txIn?: DbOrTx) {
  const data = competitionInputSchema.parse(input);
  const run = async (tx: DbOrTx) => {
    const { prizes, ...fields } = data;
    const [c] = await tx
      .insert(competitions)
      .values({
        ...fields,
        promoImageUrl: fields.promoImageUrl || null,
        slug: await uniqueSlug(tx, data.name, data.startsAt),
        status: "draft",
        templateId: opts.templateId ?? null,
        sequence: opts.sequence ?? null,
        createdByUserId: actor.type === "user" ? actor.id : null,
      })
      .returning();
    if (prizes.length) await tx.insert(prizeDefinitions).values(prizes.map((p) => ({ ...p, competitionId: c.id })));
    await audit(tx, actor, "competition.create", "competition", c.id, { after: data });
    return c;
  };
  return txIn ? run(txIn) : db.transaction(run);
}

/** Fields whose change after opening is "material" to entrants. */
const MATERIAL_FIELDS = [
  "entryFeePence",
  "shotsPerRound",
  "requireOnGreen",
  "tiePolicy",
  "format",
  "holeName",
  "holeDistanceYards",
  "jackpotEnabled",
  "jackpotAmountPence",
  "jackpotMaxWinners",
  "jackpotMaxPerPlayer",
  "jackpotMaxLiabilityPence",
  "jackpotSubsequentQualify",
  "hioCountsForWeekly",
  "endsAt",
  "startsAt",
  "entryMode",
  "maxRoundsPerCustomer",
  "termsVersion",
] as const;

/** Changes that are never allowed once entries may exist, because they could alter outcomes. */
const LOCKED_AFTER_OPEN = ["tiePolicy", "format", "requireOnGreen", "shotsPerRound", "entryMode", "entryFeePence", "hioCountsForWeekly", "startsAt"] as const;

export async function updateCompetition(id: string, input: CompetitionInput, actor: Actor, changeReason?: string) {
  const data = competitionInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(competitions).where(eq(competitions.id, id)).for("update");
    if (!before) throw new NotFoundError("Competition");
    const beforePrizes = await getPrizes(id, tx);
    if (["finalised", "archived", "cancelled"].includes(before.status)) throw new ConflictError("This competition can no longer be edited.");

    const [{ entries }] = await tx
      .select({ entries: sql<number>`count(*)::int` })
      .from(rounds)
      .where(and(eq(rounds.competitionId, id), sql`${rounds.status} not in ('cancelled')`));
    // Once any entry exists the rules are treated as live, even before opening.
    const live = ["open", "closed", "awaiting_verification"].includes(before.status) || entries > 0;
    const scheduled = before.status === "scheduled";
    const { prizes, ...fields } = data;
    const changed = MATERIAL_FIELDS.filter((f) => {
      const a = (before as Record<string, unknown>)[f];
      const b = (fields as Record<string, unknown>)[f];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : (a ?? null) !== (b ?? null);
    });
    const prizesChanged = JSON.stringify(beforePrizes.map((p) => [p.rank, p.amountPence, p.description])) !== JSON.stringify(prizes.map((p) => [p.rank, p.amountPence, p.description]));

    if (live) {
      const locked = changed.filter((f) => (LOCKED_AFTER_OPEN as readonly string[]).includes(f));
      if (locked.length) throw new ConflictError(`These rules cannot change after the competition has opened: ${locked.join(", ")}. Cancel and re-run the competition instead.`);
      // Prizes may only be increased once entries are being accepted.
      for (const p of beforePrizes) {
        const np = prizes.find((x) => x.rank === p.rank);
        if (!np || np.amountPence < p.amountPence) throw new ConflictError("Advertised prizes cannot be reduced or removed after the competition has opened.");
      }
      if (fields.jackpotEnabled !== before.jackpotEnabled || fields.jackpotAmountPence < before.jackpotAmountPence)
        throw new ConflictError("The jackpot cannot be withdrawn or reduced after the competition has opened.");
      if (fields.endsAt < before.endsAt) throw new ConflictError("The deadline cannot be brought forward after the competition has opened.");
    }
    const material = changed.length > 0 || prizesChanged;
    if ((live || scheduled) && material && !changeReason?.trim()) {
      throw new AppError("A reason is required for material changes to a published competition. Entrants will be notified.");
    }

    // Re-validate jackpot funding whenever a published competition changes.
    if ((live || scheduled) && fields.jackpotEnabled) {
      const funding = fields.jackpotFundingId ? (await tx.select().from(jackpotFunding).where(eq(jackpotFunding.id, fields.jackpotFundingId)))[0] ?? null : null;
      const problems = validateJackpotFunding(fields, funding, fields);
      if (problems.length) throw new ConflictError(problems.join(" "));
    }

    const [after] = await tx
      .update(competitions)
      .set({ ...fields, promoImageUrl: fields.promoImageUrl || null, updatedAt: new Date() })
      .where(eq(competitions.id, id))
      .returning();
    if (prizesChanged) {
      await tx.delete(prizeDefinitions).where(eq(prizeDefinitions.competitionId, id));
      if (prizes.length) await tx.insert(prizeDefinitions).values(prizes.map((p) => ({ ...p, competitionId: id })));
    }
    if ((live || scheduled) && material) {
      const [{ n }] = await tx
        .select({ n: sql<number>`coalesce(max(${competitionRuleVersions.version}), 0)::int` })
        .from(competitionRuleVersions)
        .where(eq(competitionRuleVersions.competitionId, id));
      await tx.insert(competitionRuleVersions).values({
        competitionId: id,
        version: n + 1,
        snapshot: { competition: after, prizes },
        changeSummary: `${[...changed, ...(prizesChanged ? ["prizes"] : [])].join(", ")} — ${changeReason}`,
        changedByUserId: actor.type === "user" ? actor.id : null,
      });
      await bumpLeaderboard(tx, id);
    }
    await audit(tx, actor, material && (live || scheduled) ? "competition.material_change" : "competition.update", "competition", id, {
      before: { ...before, prizes: beforePrizes },
      after: { ...after, prizes },
      reason: changeReason ?? null,
    });
    return { competition: after, materialChange: (live || scheduled) && material, changed };
  });
}

/** Everything that blocks publication. Empty array = can be scheduled. */
export async function publishBlockers(c: Competition, tx: DbOrTx = db): Promise<string[]> {
  const problems: string[] = [];
  if (!FORMAT_AVAILABILITY[c.format]) problems.push("Competition format is not available.");
  if (c.endsAt <= c.startsAt) problems.push("End time must be after start time.");
  if (c.endsAt <= new Date()) problems.push("The competition end time is in the past.");
  if (c.entryMode === "paid" && c.entryFeePence <= 0) problems.push("Paid competitions need an entry fee.");
  if (!c.rulesMarkdown.trim()) problems.push("Competition rules have not been written.");
  if (!c.tiePolicyText.trim()) problems.push("The tie-break procedure must be published before the competition opens.");
  if (!(await isLaunchApproved(c, tx))) {
    problems.push(
      c.entryMode === "paid"
        ? `Paid entry is locked: no legal approval is recorded for "${scopeForMode(c.entryMode)}" with terms version ${c.termsVersion}.`
        : `No legal/operational approval is recorded for free-entry promotions with terms version ${c.termsVersion}.`,
    );
  }
  if (c.jackpotEnabled) {
    const funding = c.jackpotFundingId ? (await tx.select().from(jackpotFunding).where(eq(jackpotFunding.id, c.jackpotFundingId)))[0] ?? null : null;
    problems.push(...validateJackpotFunding(c, funding, c));
  }
  // Overlapping live competitions on the same simulator would confuse entrants.
  const overlapping = await tx
    .select({ id: competitions.id, name: competitions.name })
    .from(competitions)
    .where(
      and(
        eq(competitions.simulatorId, c.simulatorId),
        inArray(competitions.status, ["scheduled", "open"]),
        sql`${competitions.id} <> ${c.id}`,
        sql`${competitions.startsAt} < ${c.endsAt} and ${competitions.endsAt} > ${c.startsAt}`,
      ),
    );
  if (overlapping.length) problems.push(`Overlaps another published competition on this simulator: ${overlapping.map((o) => o.name).join(", ")}.`);
  return problems;
}

async function transition(id: string, to: CompetitionStatus, actor: Actor, patch: Partial<Competition> = {}, reason?: string, txIn?: DbOrTx) {
  const run = async (tx: DbOrTx) => {
    const [c] = await tx.select().from(competitions).where(eq(competitions.id, id)).for("update");
    if (!c) throw new NotFoundError("Competition");
    assertTransition(c.status, to);
    const [after] = await tx.update(competitions).set({ ...patch, status: to, updatedAt: new Date() }).where(eq(competitions.id, id)).returning();
    await audit(tx, actor, `competition.status.${to}`, "competition", id, { before: { status: c.status }, after: { status: to }, reason });
    await bumpLeaderboard(tx, id);
    return after;
  };
  return txIn ? run(txIn) : db.transaction(run);
}

export async function submitForApproval(id: string, actor: Actor) {
  return transition(id, "pending_approval", actor);
}

export async function returnToDraft(id: string, actor: Actor, reason: string) {
  const c = await getCompetition(id);
  if (c.status === "scheduled") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(rounds).where(eq(rounds.competitionId, id));
    if (n > 0) throw new ConflictError("Entries already exist — the competition cannot be unpublished. Cancel it instead.");
  }
  return transition(id, "draft", actor, { publishedAt: null }, reason);
}

/** Approve & publish. Re-checks every blocker inside the transaction. */
export async function approveAndSchedule(id: string, actor: Actor & { type: "user" }) {
  return db.transaction(async (tx) => {
    const c = await getCompetition(id, tx);
    const problems = await publishBlockers(c, tx);
    if (problems.length) throw new ConflictError(`Cannot publish: ${problems.join(" ")}`);
    return transition(id, "scheduled", actor, { approvedByUserId: actor.id, approvedAt: new Date(), publishedAt: new Date() }, undefined, tx);
  });
}

export async function openCompetition(id: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const c = await getCompetition(id, tx);
    // The gate is re-checked at opening time: an approval may have been revoked since publication.
    if (!(await isLaunchApproved(c, tx))) throw new ConflictError("Launch approval is no longer active for this competition's entry mode/terms.");
    return transition(id, "open", actor, { openedAt: new Date() }, undefined, tx);
  });
}

/** Outstanding work that must be resolved before results can be finalised. */
export async function outstandingVerification(competitionId: string, tx: DbOrTx = db) {
  const openRounds = await tx
    .select({ id: rounds.id, status: rounds.status })
    .from(rounds)
    .where(and(eq(rounds.competitionId, competitionId), inArray(rounds.status, ["checked_in", "in_progress", "paused"])));
  const pendingHio = await tx
    .select({ id: hioClaims.id })
    .from(hioClaims)
    .where(and(eq(hioClaims.competitionId, competitionId), eq(hioClaims.status, "pending_review")));
  return { openRounds, pendingHio, blocking: openRounds.length + pendingHio.length };
}

export async function closeCompetition(id: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const c = await getCompetition(id, tx);
    if (c.status !== "open") throw new ConflictError("Only open competitions can be closed.");
    const closed = await transition(id, "closed", actor, { closedAt: new Date() }, undefined, tx);
    const out = await outstandingVerification(id, tx);
    if (out.blocking > 0) return transition(id, "awaiting_verification", actor, {}, `${out.openRounds.length} round(s) and ${out.pendingHio.length} hole-in-one claim(s) outstanding`, tx);
    return closed;
  });
}

export async function cancelCompetition(id: string, actor: Actor, reason: string) {
  if (!reason.trim()) throw new AppError("A cancellation reason is required.");
  return transition(id, "cancelled", actor, { cancelledAt: new Date(), cancelReason: reason }, reason);
}

export async function archiveCompetition(id: string, actor: Actor) {
  return transition(id, "archived", actor);
}

/** Duplicate a competition as a new draft starting `weeks` weeks later. */
export async function cloneCompetition(id: string, actor: Actor, weeks = 1) {
  const c = await getCompetition(id);
  const prizes = await getPrizes(id);
  const shift = (d: Date) => DateTime.fromJSDate(d, { zone: DEFAULT_TZ }).plus({ weeks }).toUTC().toJSDate(); // keeps local wall time across BST changes
  return createCompetition(
    {
      ...c,
      name: c.name.replace(/Week (\d+)/, (_, n) => `Week ${Number(n) + weeks}`),
      startsAt: shift(c.startsAt),
      endsAt: shift(c.endsAt),
      promoImageUrl: c.promoImageUrl,
      prizes: prizes.map((p) => ({ rank: p.rank, amountPence: p.amountPence, description: p.description })),
    },
    actor,
    { templateId: c.templateId ?? undefined, sequence: c.sequence ? c.sequence + weeks : undefined },
  );
}

/** Build competition input from a template for the week starting on `startDate` (local). */
export function inputFromTemplate(
  t: { name: string; locationId: string; simulatorId: string; config: CompetitionConfig; namePattern: string; nextSequence: number },
  startDate: string,
): CompetitionInput {
  const cfg = t.config;
  const { startsAt, endsAt } = competitionWindow(startDate, cfg.startTime, cfg.durationDays, cfg.endTime);
  const week = DateTime.fromISO(startDate, { zone: DEFAULT_TZ }).toFormat("kkkk-'W'WW");
  return {
    name: t.namePattern.replace("{n}", String(t.nextSequence)).replace("{week}", week),
    description: cfg.description,
    format: cfg.format,
    locationId: t.locationId,
    simulatorId: t.simulatorId,
    startsAt,
    endsAt,
    entryMode: cfg.entryMode,
    entryFeePence: cfg.entryMode === "free" ? 0 : cfg.entryFeePence,
    shotsPerRound: cfg.shotsPerRound,
    maxEntrants: cfg.maxEntrants,
    maxRoundsPerCustomer: cfg.maxRoundsPerCustomer,
    requireOnGreen: cfg.requireOnGreen,
    holeName: cfg.holeName,
    holeDistanceYards: cfg.holeDistanceYards,
    simulatorSettings: cfg.simulatorSettings,
    eligibility: cfg.eligibility,
    tiePolicy: cfg.tiePolicy,
    tiePolicyText: cfg.tiePolicyText,
    rulesMarkdown: cfg.rulesMarkdown,
    termsVersion: cfg.termsVersion,
    showRoundsCount: cfg.showRoundsCount,
    jackpotEnabled: cfg.jackpotEnabled,
    jackpotAmountPence: cfg.jackpotAmountPence,
    jackpotMaxWinners: cfg.jackpotMaxWinners,
    jackpotMaxPerPlayer: cfg.jackpotMaxPerPlayer,
    jackpotMaxLiabilityPence: cfg.jackpotMaxLiabilityPence,
    jackpotSubsequentQualify: cfg.jackpotSubsequentQualify,
    hioCountsForWeekly: cfg.hioCountsForWeekly,
    jackpotClaimDays: cfg.jackpotClaimDays,
    jackpotFundingId: cfg.jackpotFundingId ?? null,
    prizes: cfg.prizes,
  };
}

/**
 * Draft upcoming weekly competitions from auto-create templates. Idempotent:
 * a competition is only created if none exists for that template and start.
 * Drafts still require human approval before publication.
 */
export async function autoCreateFromTemplates(actor: Actor, now = new Date(), weeksAhead = 2) {
  const templates = await db.select().from(competitionTemplates).where(eq(competitionTemplates.autoCreateWeekly, true));
  const created: Competition[] = [];
  for (const t of templates) {
    const cfg = t.config;
    let d = DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).startOf("day");
    while (d.weekday !== cfg.startWeekday) d = d.plus({ days: 1 });
    for (let w = 0; w < weeksAhead; w++) {
      const startDate = d.plus({ weeks: w }).toISODate()!;
      const { startsAt } = competitionWindow(startDate, cfg.startTime, cfg.durationDays, cfg.endTime);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"template:" + t.id}))`);
        const [exists] = await tx
          .select({ id: competitions.id })
          .from(competitions)
          .where(and(eq(competitions.templateId, t.id), eq(competitions.startsAt, startsAt)));
        if (exists) return;
        const [fresh] = await tx.select().from(competitionTemplates).where(eq(competitionTemplates.id, t.id));
        const c = await createCompetition(inputFromTemplate(fresh, startDate), actor, { templateId: t.id, sequence: fresh.nextSequence }, tx);
        await tx.update(competitionTemplates).set({ nextSequence: fresh.nextSequence + 1 }).where(eq(competitionTemplates.id, t.id));
        created.push(c);
      });
    }
  }
  return created;
}

/** Competition to feature publicly: open > next scheduled > most recent finished. */
export async function getFeaturedCompetition(locationSlug?: string) {
  await applyDueTransitions(SYSTEM_ACTOR);
  const loc = locationSlug ? (await db.select().from(locations).where(eq(locations.slug, locationSlug)))[0] : undefined;
  const where = (statuses: CompetitionStatus[]) =>
    loc ? and(inArray(competitions.status, statuses), eq(competitions.locationId, loc.id)) : inArray(competitions.status, statuses);
  const [open] = await db.select().from(competitions).where(where(["open"])).orderBy(asc(competitions.endsAt)).limit(1);
  if (open) return open;
  const [next] = await db.select().from(competitions).where(where(["scheduled"])).orderBy(asc(competitions.startsAt)).limit(1);
  if (next) return next;
  const [recent] = await db
    .select()
    .from(competitions)
    .where(where(["closed", "awaiting_verification", "finalised"]))
    .orderBy(desc(competitions.endsAt))
    .limit(1);
  return recent ?? null;
}

/** Competitions accepting bookings now (published, not yet ended). */
export async function getBookableCompetitions() {
  return db
    .select()
    .from(competitions)
    .where(and(inArray(competitions.status, ["scheduled", "open"]), sql`${competitions.endsAt} > now()`))
    .orderBy(asc(competitions.startsAt));
}

export async function listCompetitions() {
  return db.select().from(competitions).orderBy(desc(competitions.startsAt));
}

export async function dueTransitions(now = new Date()) {
  const toOpen = await db.select().from(competitions).where(and(eq(competitions.status, "scheduled"), lte(competitions.startsAt, now)));
  const toClose = await db.select().from(competitions).where(and(eq(competitions.status, "open"), lte(competitions.endsAt, now)));
  return { toOpen, toClose };
}

/**
 * Apply any due open/close transitions now. Called from the scheduler AND
 * lazily from hot paths (console, featured competition), so deadlines are
 * enforced on time even if the cron is delayed. Idempotent and cheap when
 * nothing is due.
 */
export async function applyDueTransitions(actor: Actor, now = new Date()) {
  const { toOpen, toClose } = await dueTransitions(now);
  const log: string[] = [];
  for (const c of toOpen) {
    try {
      await openCompetition(c.id, actor);
      log.push(`opened ${c.name}`);
    } catch (e) {
      log.push(`could not open ${c.name}: ${(e as Error).message}`);
    }
  }
  for (const c of toClose) {
    try {
      const after = await closeCompetition(c.id, actor);
      log.push(`closed ${c.name} → ${after.status}`);
    } catch (e) {
      // A concurrent caller may already have closed it.
      if (!/Only open competitions/.test((e as Error).message)) log.push(`could not close ${c.name}: ${(e as Error).message}`);
    }
  }
  return log;
}
