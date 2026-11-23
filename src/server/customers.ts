import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  bookings,
  customerConsents,
  customerNotes,
  customers,
  fittingEnquiries,
  hioClaims,
  notifications,
  payments,
  prizeAwards,
  rounds,
  sessions,
  shotEvidence,
  shots,
  trackingEvents,
} from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";

export type Customer = typeof customers.$inferSelect;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalise a UK mobile to E.164 (+447…). Returns null if not a plausible UK mobile. */
export function normaliseUkMobile(input: string): string | null {
  let s = input.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+44")) s = "0" + s.slice(3);
  if (s.startsWith("44") && s.length === 12) s = "0" + s.slice(2);
  if (!/^07\d{9}$/.test(s)) return null;
  return "+44" + s.slice(1);
}

export const registrationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  email: z.string().trim().email("Enter a valid email address").max(255),
  mobile: z
    .string()
    .trim()
    .refine((v) => normaliseUkMobile(v) !== null, "Enter a valid UK mobile number (07…)"),
  acceptTerms: z.literal(true, { error: "You must accept the competition terms" }),
  confirmEligibility: z.literal(true, { error: "You must confirm you are eligible" }),
  handicap: z
    .string()
    .trim()
    .max(8)
    .regex(/^(\+?\d{1,2}(\.\d)?)?$/, "Handicap should be a number, e.g. 14.2 or +1")
    .optional()
    .or(z.literal("")),
  homeClub: z.string().trim().max(120).optional().or(z.literal("")),
  preferredHand: z.enum(["right", "left"]).optional().or(z.literal("")),
  marketingEmail: z.boolean().default(false),
  publication: z.boolean().default(false),
});
export type RegistrationInput = z.input<typeof registrationSchema>;

export interface ConsentContext {
  source: string;
  termsVersion: string;
  privacyNoticeVersion: string;
  marketingNoticeVersion: string;
  recordedByUserId?: string | null;
}

export interface Attribution {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referralCode?: string | null;
  acquisitionSource?: string | null;
}

/**
 * Find a customer by email or create one. Existing records are never
 * overwritten with possibly-wrong data from an anonymous web form; only blank
 * optional fields are filled in. Consents are always appended to the log.
 */
export async function findOrCreateCustomer(
  tx: DbOrTx,
  input: RegistrationInput,
  ctx: ConsentContext,
  actor: Actor,
  attribution: Attribution = {},
): Promise<{ customer: Customer; created: boolean; possibleDuplicateIds: string[] }> {
  const data = registrationSchema.parse(input);
  const email = normaliseEmail(data.email);
  const mobile = normaliseUkMobile(data.mobile)!;

  const [existing] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.email, email), isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));

  let customer: Customer;
  let created = false;
  if (existing) {
    const patch: Partial<Customer> = { lastActivityAt: new Date(), updatedAt: new Date() };
    if (!existing.handicap && data.handicap) patch.handicap = data.handicap;
    if (!existing.homeClub && data.homeClub) patch.homeClub = data.homeClub;
    if (!existing.preferredHand && data.preferredHand) patch.preferredHand = data.preferredHand;
    [customer] = await tx.update(customers).set(patch).where(eq(customers.id, existing.id)).returning();
  } else {
    [customer] = await tx
      .insert(customers)
      .values({
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        mobile,
        handicap: data.handicap || null,
        homeClub: data.homeClub || null,
        preferredHand: data.preferredHand || null,
        acquisitionSource: attribution.acquisitionSource ?? null,
        utmSource: attribution.utmSource ?? null,
        utmMedium: attribution.utmMedium ?? null,
        utmCampaign: attribution.utmCampaign ?? null,
        referralCode: attribution.referralCode ?? null,
      })
      .returning();
    created = true;
    await audit(tx, actor, "customer.create", "customer", customer.id, { after: { source: ctx.source } });
  }

  // Consent log (append-only). Terms + eligibility are participation conditions,
  // marketing is separate and optional (never pre-ticked).
  const rows: (typeof customerConsents.$inferInsert)[] = [
    { customerId: customer.id, type: "terms", granted: true, noticeVersion: ctx.termsVersion, source: ctx.source, recordedByUserId: ctx.recordedByUserId ?? null },
    { customerId: customer.id, type: "eligibility", granted: true, noticeVersion: ctx.termsVersion, source: ctx.source, recordedByUserId: ctx.recordedByUserId ?? null },
    { customerId: customer.id, type: "privacy_notice", granted: true, noticeVersion: ctx.privacyNoticeVersion, source: ctx.source, recordedByUserId: ctx.recordedByUserId ?? null },
  ];
  // Only record a marketing opt-in; an unticked box on a later form must not withdraw an earlier opt-in.
  if (data.marketingEmail && !customer.marketingEmailConsent) {
    rows.push({ customerId: customer.id, type: "marketing_email", granted: true, noticeVersion: ctx.marketingNoticeVersion, source: ctx.source, recordedByUserId: ctx.recordedByUserId ?? null });
  }
  if (data.publication && !customer.publicationConsent) {
    rows.push({ customerId: customer.id, type: "publication", granted: true, noticeVersion: ctx.privacyNoticeVersion, source: ctx.source, recordedByUserId: ctx.recordedByUserId ?? null });
  }
  await tx.insert(customerConsents).values(rows);
  const flags: Partial<Customer> = {};
  if (data.marketingEmail) flags.marketingEmailConsent = true;
  if (data.publication) flags.publicationConsent = true;
  if (Object.keys(flags).length) {
    [customer] = await tx.update(customers).set(flags).where(eq(customers.id, customer.id)).returning();
  }

  // Duplicate hints: same mobile, different email.
  const dupes = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.mobile, mobile), sql`${customers.id} <> ${customer.id}`, isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));

  return { customer, created, possibleDuplicateIds: dupes.map((d) => d.id) };
}

export async function setConsent(
  tx: DbOrTx,
  customerId: string,
  type: "marketing_email" | "marketing_sms" | "publication",
  granted: boolean,
  noticeVersion: string,
  source: string,
  actor: Actor,
) {
  await tx.insert(customerConsents).values({
    customerId,
    type,
    granted,
    noticeVersion,
    source,
    recordedByUserId: actor.type === "user" ? actor.id : null,
  });
  const col =
    type === "marketing_email"
      ? { marketingEmailConsent: granted }
      : type === "marketing_sms"
        ? { marketingSmsConsent: granted }
        : { publicationConsent: granted };
  await tx.update(customers).set({ ...col, updatedAt: new Date() }).where(eq(customers.id, customerId));
  await audit(tx, actor, `consent.${granted ? "grant" : "withdraw"}`, "customer", customerId, { after: { type, source } });
}

/** Public display name. Never exposes contact details. */
export function publicDisplayName(c: Pick<Customer, "id" | "firstName" | "lastName" | "displayNameStyle" | "publicationConsent" | "anonymisedAt">): string {
  if (c.anonymisedAt) return "Former player";
  const initial = c.lastName.trim().charAt(0).toUpperCase();
  const first = c.firstName.trim();
  switch (c.displayNameStyle) {
    case "anonymous":
      return `Player ${c.id.slice(0, 4).toUpperCase()}`;
    case "initials":
      return `${first.charAt(0).toUpperCase()}.${initial}.`;
    case "full":
      return c.publicationConsent ? `${first} ${c.lastName.trim()}` : `${first} ${initial}.`;
    default:
      return `${first} ${initial}.`;
  }
}

export async function searchCustomers(q: string, limit = 20) {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const mobile = normaliseUkMobile(term);
  const parts = term.split(/\s+/);
  const nameMatch =
    parts.length >= 2
      ? and(ilike(customers.firstName, `${parts[0]}%`), ilike(customers.lastName, `${parts.slice(1).join(" ")}%`))
      : or(ilike(customers.firstName, like), ilike(customers.lastName, like));
  return db
    .select()
    .from(customers)
    .where(
      and(
        isNull(customers.mergedIntoId),
        isNull(customers.anonymisedAt),
        or(nameMatch, ilike(customers.email, like), mobile ? eq(customers.mobile, mobile) : ilike(customers.mobile, like)),
      ),
    )
    .orderBy(desc(customers.lastActivityAt))
    .limit(limit);
}

export async function getCustomer(id: string, tx: DbOrTx = db) {
  const [c] = await tx.select().from(customers).where(eq(customers.id, id));
  if (!c) throw new NotFoundError("Customer");
  return c;
}

/**
 * Merge `sourceId` into `targetId`. All historical references are re-pointed
 * to the target; the source is retained as a tombstone with merged_into_id.
 */
export async function mergeCustomers(sourceId: string, targetId: string, actor: Actor, reason: string) {
  if (sourceId === targetId) throw new ConflictError("Cannot merge a customer into itself.");
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(customers).where(eq(customers.id, sourceId)).for("update");
    const [target] = await tx.select().from(customers).where(eq(customers.id, targetId)).for("update");
    if (!source || !target) throw new NotFoundError("Customer");
    if (source.mergedIntoId || target.mergedIntoId) throw new ConflictError("One of these records has already been merged.");
    // A customer must not end up with two weekly prize awards in one competition.
    const clash = await tx.execute(sql`
      select a.competition_id from prize_awards a join prize_awards b on a.competition_id = b.competition_id
      where a.customer_id = ${sourceId} and b.customer_id = ${targetId} and a.kind = 'weekly' and b.kind = 'weekly'
        and a.status <> 'cancelled' and b.status <> 'cancelled' limit 1`);
    if (clash.rows.length) throw new ConflictError("Both records hold a weekly prize in the same competition — resolve the awards before merging.");

    for (const table of [bookings, payments, rounds, hioClaims, prizeAwards, customerConsents, customerNotes, fittingEnquiries, notifications, trackingEvents]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx.update(table as any).set({ customerId: targetId }).where(eq((table as any).customerId, sourceId));
    }
    await tx
      .update(customers)
      .set({
        marketingEmailConsent: target.marketingEmailConsent || source.marketingEmailConsent,
        publicationConsent: target.publicationConsent || source.publicationConsent,
        fittingInterest: target.fittingInterest || source.fittingInterest,
        handicap: target.handicap ?? source.handicap,
        homeClub: target.homeClub ?? source.homeClub,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, targetId));
    await tx.update(customers).set({ mergedIntoId: targetId, updatedAt: new Date() }).where(eq(customers.id, sourceId));
    await tx.delete(sessions).where(and(eq(sessions.subjectType, "customer"), eq(sessions.subjectId, sourceId)));
    await audit(tx, actor, "customer.merge", "customer", targetId, { before: { sourceId, sourceEmail: source.email }, reason });
  });
}

/** Subject access: everything we hold about a customer, as JSON. */
export async function exportCustomerData(customerId: string) {
  const c = await getCustomer(customerId);
  const [consents, bks, pays, rnds, awards, enquiries, notes, msgs] = await Promise.all([
    db.select().from(customerConsents).where(eq(customerConsents.customerId, customerId)),
    db.select().from(bookings).where(eq(bookings.customerId, customerId)),
    db.select().from(payments).where(eq(payments.customerId, customerId)),
    db.select().from(rounds).where(eq(rounds.customerId, customerId)),
    db.select().from(prizeAwards).where(eq(prizeAwards.customerId, customerId)),
    db.select().from(fittingEnquiries).where(eq(fittingEnquiries.customerId, customerId)),
    db.select().from(customerNotes).where(eq(customerNotes.customerId, customerId)),
    db.select({ type: notifications.type, subject: notifications.subject, status: notifications.status, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.customerId, customerId)),
  ]);
  const roundIds = rnds.map((r) => r.id);
  const shotsRows = roundIds.length ? await db.select().from(shots).where(inArray(shots.roundId, roundIds)) : [];
  return {
    exportedAt: new Date().toISOString(),
    profile: c,
    consents,
    bookings: bks,
    payments: pays.map((p) => ({ ...p, stripeCheckoutSessionId: p.stripeCheckoutSessionId ? "[redacted]" : null })),
    rounds: rnds,
    shots: shotsRows,
    prizes: awards,
    fittingEnquiries: enquiries,
    staffNotes: notes,
    communications: msgs,
  };
}

/**
 * Erasure: anonymise personal data while keeping the competition record
 * (results, financial records) intact for integrity and accounting
 * obligations. Evidence files are queued for deletion by the caller.
 */
export async function anonymiseCustomer(customerId: string, actor: Actor, reason: string) {
  return db.transaction(async (tx) => {
    const c = await getCustomer(customerId, tx);
    if (c.anonymisedAt) return c;
    const open = await tx
      .select({ id: prizeAwards.id })
      .from(prizeAwards)
      .where(and(eq(prizeAwards.customerId, customerId), inArray(prizeAwards.status, ["provisional", "verified", "awaiting_claim", "claimed"])));
    if (open.length) throw new ConflictError("This customer has an unfulfilled prize. Settle or cancel it before erasing their data.");
    const [updated] = await tx
      .update(customers)
      .set({
        firstName: "Former",
        lastName: "Player",
        email: `erased+${customerId}@invalid.local`,
        mobile: "",
        handicap: null,
        homeClub: null,
        preferredHand: null,
        marketingEmailConsent: false,
        marketingSmsConsent: false,
        publicationConsent: false,
        displayNameStyle: "anonymous",
        anonymisedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();
    await tx.delete(customerNotes).where(eq(customerNotes.customerId, customerId));
    await tx.update(notifications).set({ toEmail: "erased@invalid.local", bodyHtml: "", bodyText: "[erased]" }).where(eq(notifications.customerId, customerId));
    await tx.delete(sessions).where(and(eq(sessions.subjectType, "customer"), eq(sessions.subjectId, customerId)));
    const evidence = await tx
      .select({ key: shotEvidence.storageKey })
      .from(shotEvidence)
      .innerJoin(rounds, eq(rounds.id, shotEvidence.roundId))
      .where(eq(rounds.customerId, customerId));
    await audit(tx, actor, "customer.anonymise", "customer", customerId, { reason });
    return { ...updated, evidenceKeys: evidence.map((e) => e.key) };
  });
}
