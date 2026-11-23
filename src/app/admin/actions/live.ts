"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, fittingEnquiries, rounds, shotEvidence, shots } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireStaffAction } from "@/lib/auth/session";
import { AppError, type ActionResult, toActionError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { ALLOWED_EVIDENCE_TYPES, MAX_EVIDENCE_BYTES, newEvidenceKey, signEvidenceUrl, sniffImageType, storage } from "@/lib/storage";
import { checkInBooking, getBookingByCode, markNoShow } from "@/server/bookings";
import { consoleState, customerOpenEntitlements } from "@/server/console";
import { publicDisplayName, searchCustomers } from "@/server/customers";
import { walkInEntry } from "@/server/entry";
import { sendRoundSummary } from "@/server/messages";
import { completeRound, correctShot, recordShot, restartRound, setRoundStatus, startRound, type ShotInput } from "@/server/rounds";

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function getConsole() {
  return run(async () => {
    await requireStaffAction("round.operate");
    return consoleState();
  });
}

export async function findCustomers(q: string) {
  return run(async () => {
    await requireStaffAction("customer.view");
    const rows = await searchCustomers(q, 12);
    return Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        display: publicDisplayName(c),
        email: c.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2"),
        mobile: c.mobile ? `•••• ${c.mobile.slice(-4)}` : "",
        entitlements: (await customerOpenEntitlements(c.id)).map((e) => ({ roundId: e.r.id, competition: e.c.name, status: e.r.status })),
      })),
    );
  });
}

const walkInSchema = z.object({
  competitionId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  newCustomer: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      mobile: z.string(),
      acceptTerms: z.boolean(),
      confirmEligibility: z.boolean(),
      marketingEmail: z.boolean(),
      publication: z.boolean().optional(),
    })
    .optional(),
  roundsQty: z.number().int().min(1).max(10),
  method: z.enum(["card_terminal", "cash", "complimentary", "free_entry"]),
  amountPence: z.number().int().min(0).optional(),
  reference: z.string().max(120).optional(),
  authorisationReason: z.string().max(500).optional(),
  overrideAvailability: z.boolean().optional(),
  idempotencyKey: z.string().min(8),
});

export async function addWalkIn(input: z.input<typeof walkInSchema>) {
  return run(async () => {
    const { user, actor } = await requireStaffAction("payment.record_instore");
    const d = walkInSchema.parse(input);
    if (d.method === "complimentary" && !can(user.role, "payment.complimentary")) throw new AppError("Only a manager can authorise complimentary entries.");
    if (d.overrideAvailability && !can(user.role, "availability.override")) throw new AppError("Only a manager can override simulator availability.");
    const res = await walkInEntry(
      {
        ...d,
        newCustomer: d.newCustomer ? { ...d.newCustomer, acceptTerms: d.newCustomer.acceptTerms as true, confirmEligibility: d.newCustomer.confirmEligibility as true } : undefined,
      },
      actor as typeof actor & { type: "user" },
    );
    return { roundIds: (res.rounds ?? []).map((r) => r.id), duplicate: res.duplicate };
  });
}

export async function checkInCode(code: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("booking.manage");
    const b = await getBookingByCode(code.replace(/[^A-Za-z0-9]/g, ""));
    if (!b) throw new AppError("No booking found for that code.");
    await checkInBooking(b.id, actor as typeof actor & { type: "user" });
    const rs = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.bookingId, b.id));
    return { bookingId: b.id, roundIds: rs.map((r) => r.id) };
  });
}

export async function checkIn(bookingId: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("booking.manage");
    await checkInBooking(bookingId, actor as typeof actor & { type: "user" });
  });
}

export async function noShow(bookingId: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("booking.manage");
    await markNoShow(bookingId, actor);
  });
}

export async function beginRound(roundId: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("round.operate");
    await startRound(roundId, actor as typeof actor & { type: "user" });
  });
}

export async function saveShot(roundId: string, input: ShotInput) {
  return run(async () => {
    const { actor } = await requireStaffAction("round.operate");
    const r = await recordShot(roundId, input, actor as typeof actor & { type: "user" });
    return { shotId: r.shot.id, duplicate: r.duplicate };
  });
}

export async function fixShot(shotId: string, input: Omit<ShotInput, "shotNumber"> | { remove: true }, reason: string) {
  return run(async () => {
    const { user, actor } = await requireStaffAction("round.operate");
    await correctShot(shotId, input, reason, actor as typeof actor & { type: "user" }, { canCorrectVerified: can(user.role, "round.correct_verified") });
  });
}

export async function finishRound(roundId: string, earlyReason?: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("round.operate");
    const res = await completeRound(roundId, actor as typeof actor & { type: "user" }, earlyReason);
    if (!res.alreadyCompleted) await sendRoundSummary(roundId).catch((e) => console.error("[round summary]", e));
    return { completed: true };
  });
}

export async function changeRoundStatus(roundId: string, to: "paused" | "in_progress" | "voided" | "disqualified", reason: string) {
  return run(async () => {
    const { user, actor } = await requireStaffAction("round.operate");
    if (to === "disqualified" && !can(user.role, "round.disqualify")) throw new AppError("Only a manager can disqualify a round.");
    await setRoundStatus(roundId, to, reason, actor as typeof actor & { type: "user" });
  });
}

export async function restart(roundId: string, reason: string) {
  return run(async () => {
    const { actor } = await requireStaffAction("round.operate");
    const r = await restartRound(roundId, reason, actor as typeof actor & { type: "user" });
    return { roundId: r.id };
  });
}

/** Evidence upload (simulator screenshot). Validated by magic bytes; stored privately. */
export async function uploadEvidence(form: FormData) {
  return run(async () => {
    const { user, actor } = await requireStaffAction("round.operate");
    const roundId = z.string().uuid().parse(form.get("roundId"));
    const shotId = form.get("shotId") ? z.string().uuid().parse(form.get("shotId")) : null;
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose an image to upload.");
    if (file.size > MAX_EVIDENCE_BYTES) throw new AppError("Image is too large (max 8 MB).");
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniffImageType(buf);
    if (!type || !ALLOWED_EVIDENCE_TYPES[type]) throw new AppError("Only PNG, JPEG or WebP images are accepted.");
    const [r] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!r) throw new AppError("Round not found.");
    if (shotId) {
      const [s] = await db.select().from(shots).where(eq(shots.id, shotId));
      if (!s || s.roundId !== roundId) throw new AppError("Shot does not belong to this round.");
    }
    const key = newEvidenceKey(roundId, ALLOWED_EVIDENCE_TYPES[type]);
    await storage().put(key, buf, type);
    const [row] = await db
      .insert(shotEvidence)
      .values({ roundId, shotId, storageKey: key, contentType: type, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), uploadedByUserId: user.id })
      .returning();
    await audit(db, actor, "evidence.upload", "shot_evidence", row.id, { after: { roundId, shotId, sha256: row.sha256 } });
    return { id: row.id, url: signEvidenceUrl(key) };
  });
}

export async function flagFittingInterest(customerId: string, competitionId: string | null) {
  return run(async () => {
    const { user, actor } = await requireStaffAction("customer.notes");
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ fittingInterest: true, updatedAt: new Date() }).where(eq(customers.id, customerId));
      await tx.insert(fittingEnquiries).values({ customerId, competitionId, source: "counter_after_round", createdByUserId: user.id });
      await audit(tx, actor, "fitting.enquiry_flagged", "customer", customerId);
    });
  });
}
