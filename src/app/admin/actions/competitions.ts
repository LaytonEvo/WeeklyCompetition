"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { competitionTemplates, type CompetitionConfig } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireStaffAction } from "@/lib/auth/session";
import { AppError, toActionError } from "@/lib/errors";
import { parsePoundsToPence } from "@/lib/money";
import { localToUtc } from "@/lib/time";
import {
  approveAndSchedule, archiveCompetition, cancelCompetition, cloneCompetition, closeCompetition, createCompetition, openCompetition, returnToDraft, submitForApproval, updateCompetition, type CompetitionInput,
} from "@/server/competitions";
import { notifyEntrants, sendWinnerNotification } from "@/server/messages";
import { finaliseCompetition } from "@/server/results";

type State = { ok: boolean; error?: string; message?: string } | null;

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const b = (f: FormData, k: string) => f.get(k) === "on";
const intOrNull = (f: FormData, k: string) => (s(f, k) === "" ? null : Number(s(f, k)));
function pounds(f: FormData, k: string, required = true) {
  const v = s(f, k);
  if (v === "" && !required) return null;
  const p = parsePoundsToPence(v === "" ? "0" : v);
  if (p === null) throw new AppError(`"${k}" must be an amount in pounds, e.g. 5 or 5.00`);
  return p;
}

/** Shared parser for competition and template forms. */
function parseCompetitionForm(f: FormData): CompetitionInput {
  const prizes = [];
  for (let i = 1; i <= 5; i++) {
    const amount = s(f, `prize${i}`);
    const desc = s(f, `prize${i}desc`);
    if (!amount && !desc) continue;
    prizes.push({ rank: i, amountPence: pounds(f, `prize${i}`) ?? 0, description: desc });
  }
  const mode = s(f, "entryMode") as "paid" | "free";
  return {
    name: s(f, "name"),
    description: s(f, "description"),
    format: (s(f, "format") || "closest_to_pin") as CompetitionInput["format"],
    locationId: s(f, "locationId"),
    simulatorId: s(f, "simulatorId"),
    startsAt: localToUtc(s(f, "startDate"), s(f, "startTime") || "09:00"),
    endsAt: localToUtc(s(f, "endDate"), s(f, "endTime") || "18:00"),
    entryMode: mode,
    entryFeePence: mode === "free" ? 0 : (pounds(f, "entryFee") ?? 0),
    shotsPerRound: Number(s(f, "shotsPerRound") || 5),
    maxEntrants: intOrNull(f, "maxEntrants"),
    maxRoundsPerCustomer: intOrNull(f, "maxRoundsPerCustomer"),
    requireOnGreen: b(f, "requireOnGreen"),
    holeName: s(f, "holeName"),
    holeDistanceYards: intOrNull(f, "holeDistanceYards"),
    simulatorSettings: s(f, "simulatorSettings"),
    eligibility: s(f, "eligibility"),
    tiePolicy: s(f, "tiePolicy") as CompetitionInput["tiePolicy"],
    tiePolicyText: s(f, "tiePolicyText"),
    rulesMarkdown: s(f, "rulesMarkdown"),
    termsVersion: s(f, "termsVersion"),
    promoImageUrl: s(f, "promoImageUrl") || null,
    showRoundsCount: b(f, "showRoundsCount"),
    jackpotEnabled: b(f, "jackpotEnabled"),
    jackpotAmountPence: pounds(f, "jackpotAmount", false) ?? 0,
    jackpotMaxWinners: intOrNull(f, "jackpotMaxWinners"),
    jackpotMaxPerPlayer: Number(s(f, "jackpotMaxPerPlayer") || 1),
    jackpotMaxLiabilityPence: pounds(f, "jackpotMaxLiability", false),
    jackpotSubsequentQualify: b(f, "jackpotSubsequentQualify"),
    hioCountsForWeekly: b(f, "hioCountsForWeekly"),
    jackpotClaimDays: Number(s(f, "jackpotClaimDays") || 30),
    jackpotFundingId: s(f, "jackpotFundingId") || null,
    prizes,
  };
}

export async function createCompetitionAction(_p: State, f: FormData): Promise<State> {
  let id: string;
  try {
    const { actor } = await requireStaffAction("competition.manage");
    const c = await createCompetition(parseCompetitionForm(f), actor);
    id = c.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/admin/competitions/${id}`);
}

export async function updateCompetitionAction(_p: State, f: FormData): Promise<State> {
  try {
    const { actor } = await requireStaffAction("competition.manage");
    const id = z.string().uuid().parse(f.get("id"));
    const reason = s(f, "changeReason");
    const res = await updateCompetition(id, parseCompetitionForm(f), actor, reason || undefined);
    if (res.materialChange) await notifyEntrants(id, "changed", `The following was updated: ${res.changed.join(", ") || "prizes"}. Reason: ${reason}`, `v${Date.now()}`);
    revalidatePath(`/admin/competitions/${id}`);
    return { ok: true, message: res.materialChange ? "Saved. Material change recorded and entrants notified." : "Saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function lifecycleAction(_p: State, f: FormData): Promise<State> {
  try {
    const id = z.string().uuid().parse(f.get("id"));
    const op = s(f, "op");
    const reason = s(f, "reason");
    const perm = op === "finalise" ? "competition.finalise" : "competition.manage";
    const { actor } = await requireStaffAction(perm);
    const user = actor as typeof actor & { type: "user" };
    let message = "Done.";
    switch (op) {
      case "submit":
        await submitForApproval(id, actor);
        message = "Submitted for approval.";
        break;
      case "approve":
        await approveAndSchedule(id, user);
        message = "Approved and published. It will open automatically at its start time.";
        break;
      case "draft":
        await returnToDraft(id, actor, reason || "Returned to draft");
        break;
      case "open":
        await openCompetition(id, actor);
        message = "Competition opened.";
        break;
      case "close":
        await closeCompetition(id, actor);
        message = "Competition closed. No new rounds can start.";
        break;
      case "cancel": {
        await cancelCompetition(id, actor, reason);
        const n = await notifyEntrants(id, "cancelled", `This competition has been cancelled. Reason: ${reason}`, "cancel");
        message = `Cancelled. ${n} entrant(s) notified. Refund unplayed paid entries from Payments.`;
        break;
      }
      case "archive":
        await archiveCompetition(id, actor);
        break;
      default:
        throw new AppError("Unknown action");
    }
    revalidatePath(`/admin/competitions/${id}`);
    return { ok: true, message };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cloneAction(_p: State, f: FormData): Promise<State> {
  let id: string;
  try {
    const { actor } = await requireStaffAction("competition.manage");
    const c = await cloneCompetition(z.string().uuid().parse(f.get("id")), actor, Number(s(f, "weeks") || 1));
    id = c.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/admin/competitions/${id}`);
}

export async function finaliseAction(_p: State, f: FormData): Promise<State> {
  try {
    const { actor } = await requireStaffAction("competition.finalise");
    const id = z.string().uuid().parse(f.get("id"));
    // Playoff results arrive as playoff_<rank>_<finishingPosition> = customerId
    const playoffOrder: Record<number, string[]> = {};
    for (const [k, v] of f.entries()) {
      const m = /^playoff_(\d+)_(\d+)$/.exec(k);
      if (m && v) (playoffOrder[Number(m[1])] ??= [])[Number(m[2])] = String(v);
    }
    const res = await finaliseCompetition(id, actor as typeof actor & { type: "user" }, { playoffOrder, notes: s(f, "notes") || undefined });
    if (!res.alreadyFinalised) for (const a of res.awards) await sendWinnerNotification(a.id, "official").catch((e) => console.error(e));
    revalidatePath(`/admin/competitions/${id}/results`);
    return { ok: true, message: `Results finalised. ${res.awards.length} prize award(s) recorded and winners notified.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Save the weekly template from a competition-shaped form. */
export async function saveTemplateAction(_p: State, f: FormData): Promise<State> {
  try {
    const { actor } = await requireStaffAction("competition.manage");
    const id = z.string().uuid().parse(f.get("templateId"));
    // Dates on the template form are placeholders; only wall-clock times/duration matter.
    const input = parseCompetitionForm(f);
    const [tpl] = await db.select().from(competitionTemplates).where(eq(competitionTemplates.id, id));
    if (!tpl) throw new AppError("Template not found");
    const config: CompetitionConfig = {
      ...tpl.config,
      format: input.format ?? "closest_to_pin",
      description: input.description ?? "",
      entryMode: input.entryMode,
      entryFeePence: input.entryFeePence,
      shotsPerRound: input.shotsPerRound,
      durationDays: Number(s(f, "durationDays") || 7),
      startWeekday: Number(s(f, "startWeekday") || 1),
      startTime: s(f, "startTime") || "09:00",
      endTime: s(f, "endTime") || "18:00",
      prizes: (input.prizes ?? []).map((p) => ({ ...p, description: p.description ?? "" })),
      jackpotEnabled: input.jackpotEnabled ?? false,
      jackpotAmountPence: input.jackpotAmountPence ?? 0,
      jackpotMaxWinners: input.jackpotMaxWinners ?? null,
      jackpotMaxPerPlayer: input.jackpotMaxPerPlayer ?? 1,
      jackpotMaxLiabilityPence: input.jackpotMaxLiabilityPence ?? null,
      jackpotSubsequentQualify: input.jackpotSubsequentQualify ?? true,
      hioCountsForWeekly: input.hioCountsForWeekly ?? true,
      jackpotClaimDays: input.jackpotClaimDays ?? 30,
      requireOnGreen: input.requireOnGreen ?? true,
      holeName: input.holeName ?? "",
      holeDistanceYards: input.holeDistanceYards ?? 0,
      simulatorSettings: input.simulatorSettings ?? "",
      eligibility: input.eligibility ?? "",
      maxEntrants: input.maxEntrants ?? null,
      maxRoundsPerCustomer: input.maxRoundsPerCustomer ?? null,
      tiePolicy: input.tiePolicy ?? "equal_rank_split",
      tiePolicyText: input.tiePolicyText ?? "",
      rulesMarkdown: input.rulesMarkdown ?? "",
      termsVersion: input.termsVersion,
      showRoundsCount: input.showRoundsCount ?? true,
      jackpotFundingId: input.jackpotFundingId ?? null,
    };
    await db.update(competitionTemplates).set({ config, name: s(f, "templateName") || tpl.name, autoCreateWeekly: b(f, "autoCreateWeekly"), namePattern: s(f, "namePattern") || tpl.namePattern, updatedAt: new Date() }).where(eq(competitionTemplates.id, id));
    await audit(db, actor, "template.update", "competition_template", id, { before: tpl.config, after: config });
    return { ok: true, message: "Template saved. New weekly drafts will use these settings (existing competitions are unchanged)." };
  } catch (e) {
    return toActionError(e);
  }
}
