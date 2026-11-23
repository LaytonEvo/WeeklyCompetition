"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { availabilityRules, blockedPeriods, customerNotes, customers, fittingEnquiries, hioClaims, jackpotFunding, simulators, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireStaffAction } from "@/lib/auth/session";
import { hashPassword } from "@/lib/crypto";
import { AppError, toActionError } from "@/lib/errors";
import { parsePoundsToPence } from "@/lib/money";
import { appSettingsSchema, getSettings, saveSettings } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { localToUtc } from "@/lib/time";
import { cancelBooking, moveBooking } from "@/server/bookings";
import { anonymiseCustomer, mergeCustomers, normaliseEmail, normaliseUkMobile, setConsent } from "@/server/customers";
import { reviewClaim } from "@/server/hio";
import { recordApproval, revokeApproval } from "@/server/legal";
import { sendBookingCancelled, sendHioUpdate, sendRefundIssued, sendWinnerNotification } from "@/server/messages";
import { refundPayment } from "@/server/payments";
import { updatePrize } from "@/server/results";

type State = { ok: boolean; error?: string; message?: string } | null;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const uuid = (f: FormData, k: string) => z.string().uuid().parse(f.get(k));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const done = (message: string, path?: string): State => {
  if (path) revalidatePath(path);
  return { ok: true, message };
};
async function wrap(fn: () => Promise<State>): Promise<State> {
  try {
    return await fn();
  } catch (e) {
    return toActionError(e);
  }
}
type UserActor = { type: "user"; id: string; label: string; role: "super_admin" | "manager" | "staff" | "marketing" };

/* ---------------- Availability ---------------- */

export async function addRule(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("availability.manage");
    const days = f.getAll("weekday").map(Number);
    if (!days.length) throw new AppError("Choose at least one day.");
    const start = hhmm.parse(s(f, "startTime"));
    const end = hhmm.parse(s(f, "endTime"));
    if (end <= start) throw new AppError("End time must be after start time.");
    const kind = z.enum(["opening_hours", "competition_window"]).parse(s(f, "kind"));
    const simulatorId = uuid(f, "simulatorId");
    await db.insert(availabilityRules).values(days.map((weekday) => ({ simulatorId, kind, weekday, startTime: start, endTime: end })));
    await audit(db, actor, "availability.rule_add", "simulator", simulatorId, { after: { kind, days, start, end } });
    return done("Saved.", "/admin/availability");
  });
}

export async function deleteRule(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("availability.manage");
    const id = uuid(f, "id");
    const [r] = await db.delete(availabilityRules).where(eq(availabilityRules.id, id)).returning();
    await audit(db, actor, "availability.rule_delete", "availability_rule", id, { before: r });
    return done("Removed.", "/admin/availability");
  });
}

export async function addBlock(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("availability.manage");
    const simulatorId = uuid(f, "simulatorId");
    const kind = z.enum(["fitting", "maintenance", "closed", "private_event", "other"]).parse(s(f, "kind"));
    const title = z.string().min(1, "Add a title").max(120).parse(s(f, "title"));
    const recurring = f.get("recurring") === "on";
    const startTime = hhmm.parse(s(f, "startTime"));
    const endTime = hhmm.parse(s(f, "endTime"));
    if (endTime <= startTime) throw new AppError("End time must be after start time.");
    if (recurring) {
      const weekday = z.coerce.number().int().min(1).max(7).parse(s(f, "weekday"));
      await db.insert(blockedPeriods).values({ simulatorId, kind, title, recurringWeekday: weekday, recurringStart: startTime, recurringEnd: endTime, recurringUntil: s(f, "until") ? localToUtc(s(f, "until"), "23:59") : null, createdByUserId: user.id });
    } else {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").parse(s(f, "date"));
      const endDate = s(f, "endDate") || date;
      await db.insert(blockedPeriods).values({ simulatorId, kind, title, startsAt: localToUtc(date, startTime), endsAt: localToUtc(endDate, endTime), createdByUserId: user.id });
    }
    await audit(db, actor, "availability.block_add", "simulator", simulatorId, { after: { kind, title, recurring } });
    return done("Blocked period added. Existing bookings in that time are not cancelled automatically — check the bookings list.", "/admin/availability");
  });
}

export async function deleteBlock(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("availability.manage");
    const id = uuid(f, "id");
    const [b] = await db.delete(blockedPeriods).where(eq(blockedPeriods.id, id)).returning();
    await audit(db, actor, "availability.block_delete", "blocked_period", id, { before: b });
    return done("Removed.", "/admin/availability");
  });
}

export async function updateSimulator(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("availability.manage");
    const id = uuid(f, "id");
    const patch = {
      slotMinutes: z.coerce.number().int().min(5).max(60).parse(s(f, "slotMinutes")),
      slotCapacity: z.coerce.number().int().min(1).max(4).parse(s(f, "slotCapacity")),
      available: f.get("available") === "on",
      unavailableReason: s(f, "unavailableReason") || null,
      name: z.string().min(1).parse(s(f, "name")),
    };
    const [before] = await db.select().from(simulators).where(eq(simulators.id, id));
    await db.update(simulators).set(patch).where(eq(simulators.id, id));
    await audit(db, actor, "simulator.update", "simulator", id, { before, after: patch });
    return done(patch.available ? "Saved." : "Saved. The simulator is marked unavailable — online booking shows no slots.", "/admin/availability");
  });
}

/* ---------------- Bookings ---------------- */

export async function cancelBookingAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("booking.manage");
    const id = uuid(f, "id");
    const reason = z.string().min(3, "Give a reason").parse(s(f, "reason"));
    await cancelBooking(id, actor, reason);
    if (f.get("notify") === "on") await sendBookingCancelled(id, reason);
    return done("Booking cancelled. If paid, issue a refund from Payments.", "/admin/bookings");
  });
}

export async function moveBookingAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("booking.manage");
    const id = uuid(f, "id");
    const when = localToUtc(s(f, "date"), hhmm.parse(s(f, "time")));
    const override = f.get("override") === "on" && (user.role === "manager" || user.role === "super_admin");
    await moveBooking(id, when, actor, override);
    return done("Booking moved.", "/admin/bookings");
  });
}

/* ---------------- Customers ---------------- */

export async function updateCustomer(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("customer.edit");
    const id = uuid(f, "id");
    const [before] = await db.select().from(customers).where(eq(customers.id, id));
    const mobile = normaliseUkMobile(s(f, "mobile"));
    if (!mobile) throw new AppError("Enter a valid UK mobile number.");
    const patch = {
      firstName: z.string().min(1).max(60).parse(s(f, "firstName")),
      lastName: z.string().min(1).max(60).parse(s(f, "lastName")),
      email: normaliseEmail(z.string().email().parse(s(f, "email"))),
      mobile,
      handicap: s(f, "handicap") || null,
      homeClub: s(f, "homeClub") || null,
      displayNameStyle: z.enum(["first_initial", "full", "initials", "anonymous"]).parse(s(f, "displayNameStyle")),
      fittingInterest: f.get("fittingInterest") === "on",
      updatedAt: new Date(),
    };
    await db.update(customers).set(patch).where(eq(customers.id, id));
    await audit(db, actor, "customer.update", "customer", id, { before, after: patch });
    return done("Customer updated.", `/admin/customers/${id}`);
  });
}

export async function addNote(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("customer.notes");
    const id = uuid(f, "id");
    const body = z.string().min(1).max(2000).parse(s(f, "body"));
    await db.insert(customerNotes).values({ customerId: id, body, authorUserId: user.id });
    await audit(db, actor, "customer.note_add", "customer", id);
    return done("Note added.", `/admin/customers/${id}`);
  });
}

export async function withdrawConsent(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("customer.view");
    const id = uuid(f, "id");
    const type = z.enum(["marketing_email", "marketing_sms", "publication"]).parse(s(f, "type"));
    const st = await getSettings();
    await setConsent(db, id, type, false, st.privacy.marketingNoticeVersion, "staff_on_request", actor);
    return done("Consent withdrawn and logged.", `/admin/customers/${id}`);
  });
}

export async function mergeAction(_p: State, f: FormData) {
  let target: string;
  try {
    const { actor } = await requireStaffAction("customer.merge");
    const source = uuid(f, "sourceId");
    target = uuid(f, "targetId");
    await mergeCustomers(source, target, actor, z.string().min(3, "Give a reason").parse(s(f, "reason")));
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/admin/customers/${target}`);
}

export async function anonymiseAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("customer.erase");
    const id = uuid(f, "id");
    if (s(f, "confirm") !== "ERASE") throw new AppError('Type ERASE to confirm.');
    const res = await anonymiseCustomer(id, actor, z.string().min(3).parse(s(f, "reason")));
    if ("evidenceKeys" in res) for (const k of res.evidenceKeys) await storage().remove(k).catch(() => undefined);
    return done("Personal data erased. Results are kept anonymously.", `/admin/customers/${id}`);
  });
}

export async function recordFittingEnquiry(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("customer.notes");
    const id = uuid(f, "customerId");
    const status = z.enum(["new", "contacted", "booked", "completed", "lost"]).parse(s(f, "status") || "new");
    const sale = s(f, "saleValue") ? parsePoundsToPence(s(f, "saleValue")) : null;
    const enquiryId = s(f, "enquiryId");
    if (enquiryId) {
      await db.update(fittingEnquiries).set({ status, saleValuePence: sale, bookedAt: status === "booked" ? new Date() : undefined, notes: s(f, "notes") || null, updatedAt: new Date() }).where(eq(fittingEnquiries.id, enquiryId));
    } else {
      await db.insert(fittingEnquiries).values({ customerId: id, source: s(f, "source") || "staff", status, saleValuePence: sale, notes: s(f, "notes") || null, createdByUserId: user.id, bookedAt: status === "booked" ? new Date() : null });
      await db.update(customers).set({ fittingInterest: true }).where(eq(customers.id, id));
    }
    await audit(db, actor, "fitting.enquiry_update", "customer", id, { after: { status, sale } });
    return done("Fitting enquiry saved.", `/admin/customers/${id}`);
  });
}

/* ---------------- Payments ---------------- */

export async function refundAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("payment.refund");
    const id = uuid(f, "id");
    const amount = parsePoundsToPence(s(f, "amount"));
    if (!amount) throw new AppError("Enter the refund amount in pounds.");
    const refund = await refundPayment(id, { amountPence: amount, reason: s(f, "reason"), idempotencyKey: s(f, "key"), cancelUnplayedRounds: Number(s(f, "cancelRounds") || 0) }, actor);
    if (refund) await sendRefundIssued(id, refund.amountPence, refund.id).catch(() => undefined);
    return done("Refund recorded.", "/admin/payments");
  });
}

/* ---------------- Hole-in-one & prizes ---------------- */

export async function reviewClaimAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("hio.review");
    const id = uuid(f, "id");
    const decision = z.enum(["approve", "reject"]).parse(s(f, "decision"));
    const res = await reviewClaim(id, decision, s(f, "reason"), actor as UserActor);
    const [claim] = await db.select().from(hioClaims).where(eq(hioClaims.id, id));
    await sendHioUpdate(id, claim.customerId, decision === "approve", { eligible: Boolean(res.jackpotEligible), amountPence: res.status === "approved" && res.award ? res.award.prizeAmountPence : 0, reason: res.status === "approved" ? res.ineligibleReason : undefined }).catch(() => undefined);
    if (res.status === "approved" && res.award) await sendWinnerNotification(res.award.id, "official").catch(() => undefined);
    return done(decision === "approve" ? (res.jackpotEligible ? "Approved — jackpot award created and the player notified." : `Approved as a hole-in-one but not jackpot-eligible: ${res.status === "approved" ? res.ineligibleReason : ""}`) : "Claim rejected and the player notified.", "/admin/hole-in-one");
  });
}

export async function prizeAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("prize.manage");
    const id = uuid(f, "id");
    const to = z.enum(["claimed", "fulfilled", "expired", "cancelled", "awaiting_claim"]).parse(s(f, "to"));
    const paid = s(f, "paidAmount") ? parsePoundsToPence(s(f, "paidAmount")) : undefined;
    await updatePrize(id, to, { paidAmountPence: paid ?? undefined, paymentMethod: s(f, "paymentMethod") || undefined, paymentReference: s(f, "paymentReference") || undefined, notes: s(f, "notes") || undefined }, actor as UserActor);
    return done(`Prize marked ${to.replaceAll("_", " ")}.`, "/admin/winners");
  });
}

/* ---------------- Settings, legal, funding, users ---------------- */

export async function saveSettingsAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("settings.manage");
    const current = await getSettings();
    const raw = s(f, "json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError("Settings must be valid JSON.");
    }
    const next = appSettingsSchema.parse(parsed);
    await saveSettings(next, user.id);
    await audit(db, actor, "settings.update", "settings", "app", { before: current, after: next });
    return done("Settings saved.", "/admin/settings");
  });
}

export async function saveSettingsSection(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("settings.manage");
    const current = await getSettings();
    const next = structuredClone(current) as Record<string, Record<string, unknown>>;
    for (const [k, v] of f.entries()) {
      const m = /^(\w+)\.(\w+)(?:\.(\w+))?$/.exec(k);
      if (!m) continue;
      const [, sec, key, sub] = m;
      const target = sub ? (next[sec][key] as Record<string, unknown>) : next[sec];
      const field = sub ?? key;
      const prev = target[field];
      target[field] = typeof prev === "number" ? Number(v) : typeof prev === "boolean" ? v === "on" : String(v);
    }
    // unchecked checkboxes aren't submitted
    for (const k of String(f.get("_booleans") ?? "").split(",").filter(Boolean)) {
      const [sec, key] = k.split(".");
      if (!f.has(k)) next[sec][key] = false;
    }
    const parsed = appSettingsSchema.parse(next);
    await saveSettings(parsed, user.id);
    await audit(db, actor, "settings.update", "settings", "app", { before: current, after: parsed });
    return done("Settings saved.", "/admin/settings");
  });
}

export async function recordApprovalAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("legal.approve");
    if (f.get("attest") !== "on") throw new AppError("You must confirm the attestation.");
    await recordApproval(
      {
        scope: z.enum(["paid_entry", "free_promotion"]).parse(s(f, "scope")),
        termsVersion: z.string().min(1).parse(s(f, "termsVersion")),
        reviewerName: z.string().min(2, "Name the reviewer").parse(s(f, "reviewerName")),
        reviewerOrganisation: s(f, "reviewerOrganisation") || undefined,
        notes: s(f, "notes") || undefined,
      },
      actor as UserActor,
    );
    return done("Approval recorded.", "/admin/settings/legal");
  });
}

export async function revokeApprovalAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { actor } = await requireStaffAction("legal.approve");
    await revokeApproval(uuid(f, "id"), z.string().min(3, "Give a reason").parse(s(f, "reason")), actor as UserActor);
    return done("Approval revoked. Affected competitions can no longer open or take payment.", "/admin/settings/legal");
  });
}

export async function addFundingAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("funding.manage");
    const limit = parsePoundsToPence(s(f, "coverageLimit"));
    if (!limit) throw new AppError("Enter the coverage limit.");
    const confirmed = f.get("simulatorCoverageConfirmed") === "on";
    const [row] = await db
      .insert(jackpotFunding)
      .values({
        kind: z.enum(["insurance", "allocated_funds"]).parse(s(f, "kind")),
        provider: z.string().min(2).parse(s(f, "provider")),
        policyReference: s(f, "policyReference") || null,
        coverageLimitPence: limit,
        perEventLimitPence: s(f, "perEventLimit") ? parsePoundsToPence(s(f, "perEventLimit")) : null,
        validFrom: localToUtc(s(f, "validFrom"), "00:00"),
        validTo: localToUtc(s(f, "validTo"), "23:59"),
        coveredFormat: z.string().min(2).parse(s(f, "coveredFormat")),
        exclusions: s(f, "exclusions") || null,
        evidenceRequirements: s(f, "evidenceRequirements") || null,
        simulatorCoverageConfirmed: confirmed,
        confirmedByUserId: confirmed ? user.id : null,
        confirmedAt: confirmed ? new Date() : null,
      })
      .returning();
    await audit(db, actor, "funding.add", "jackpot_funding", row.id, { after: row });
    return done("Funding record added.", "/admin/settings/legal");
  });
}

export async function saveUserAction(_p: State, f: FormData) {
  return wrap(async () => {
    const { user, actor } = await requireStaffAction("users.manage");
    const id = s(f, "id");
    const role = z.enum(["super_admin", "manager", "staff", "marketing"]).parse(s(f, "role"));
    const password = s(f, "password");
    if (password && password.length < 12) throw new AppError("Passwords must be at least 12 characters.");
    if (id) {
      if (id === user.id && (role !== "super_admin" || f.get("active") !== "on")) throw new AppError("You can't remove your own Super Admin access.");
      const patch: Partial<typeof users.$inferInsert> = { role, name: s(f, "name"), active: f.get("active") === "on" };
      if (password) patch.passwordHash = await hashPassword(password);
      await db.update(users).set(patch).where(eq(users.id, id));
      await audit(db, actor, "user.update", "user", id, { after: { role, active: patch.active, passwordReset: Boolean(password) } });
    } else {
      if (!password) throw new AppError("Set an initial password.");
      const [u] = await db.insert(users).values({ email: z.string().email().parse(s(f, "email").toLowerCase()), name: z.string().min(1).parse(s(f, "name")), role, passwordHash: await hashPassword(password) }).returning();
      await audit(db, actor, "user.create", "user", u.id, { after: { role } });
    }
    return done("User saved.", "/admin/settings/users");
  });
}
