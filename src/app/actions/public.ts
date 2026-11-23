"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { bookings, customers, payments } from "@/db/schema";
import { endSession, getCustomer, startSession } from "@/lib/auth/session";
import { showDevMagicLinks } from "@/lib/env";
import { toActionError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { consumeMagicLink, requestMagicLink } from "@/server/auth";
import { cancelBooking } from "@/server/bookings";
import { setConsent } from "@/server/customers";
import { startOnlineEntry } from "@/server/entry";
import { sendBookingCancelled } from "@/server/messages";

async function ip() {
  return ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
}

async function attribution() {
  const raw = (await cookies()).get("ph_attr")?.value;
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, string>;
    return { utmSource: v.utm_source || null, utmMedium: v.utm_medium || null, utmCampaign: v.utm_campaign || null, referralCode: v.ref || null };
  } catch {
    return {};
  }
}

const entrySchema = z.object({
  competitionId: z.string().uuid(),
  startsAt: z.string().datetime(),
  roundsQty: z.coerce.number().int().min(1).max(10),
  idempotencyKey: z.string().min(8).max(100),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  mobile: z.string(),
  handicap: z.string().optional(),
  homeClub: z.string().optional(),
  preferredHand: z.string().optional(),
  acceptTerms: z.boolean(),
  confirmEligibility: z.boolean(),
  marketingEmail: z.boolean(),
  publication: z.boolean(),
});

export type EntryResult = { ok: true; redirectTo: string } | { ok: false; error: string };

export async function submitEntry(input: z.input<typeof entrySchema>): Promise<EntryResult> {
  try {
    const d = entrySchema.parse(input);
    const addr = await ip();
    if (addr) await rateLimit(`entry:${addr}`, 15, 3600);
    const res = await startOnlineEntry({
      competitionId: d.competitionId,
      startsAt: new Date(d.startsAt),
      roundsQty: d.roundsQty,
      idempotencyKey: d.idempotencyKey,
      attribution: await attribution(),
      registration: {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        mobile: d.mobile,
        handicap: d.handicap,
        homeClub: d.homeClub,
        preferredHand: (d.preferredHand || "") as "right" | "left" | "",
        acceptTerms: d.acceptTerms as true,
        confirmEligibility: d.confirmEligibility as true,
        marketingEmail: d.marketingEmail,
        publication: d.publication,
      },
    });
    return { ok: true, redirectTo: res.checkoutUrl ?? `/booking/${res.bookingCode}?new=1` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestLogin(_prev: unknown, form: FormData) {
  try {
    const email = z.string().email("Enter a valid email address").parse(form.get("email"));
    const next = String(form.get("next") ?? "/account");
    const { url } = await requestMagicLink(email, await ip(), next);
    return { ok: true as const, message: "If that email has a Pin Hunters account, a sign-in link is on its way. It expires in 20 minutes.", devLink: showDevMagicLinks() ? url : null };
  } catch (e) {
    return { ...toActionError(e), devLink: null };
  }
}

export async function verifyLoginToken(token: string) {
  const res = await consumeMagicLink(token);
  if (!res) return null;
  await startSession("customer", res.customerId);
  return res.redirectTo;
}

export async function logoutCustomer() {
  await endSession("customer");
  redirect("/");
}

export async function updatePreferences(_prev: unknown, form: FormData) {
  try {
    const me = await getCustomer();
    if (!me) return { ok: false, error: "Please sign in again." };
    const s = await getSettings();
    const [c] = await db.select().from(customers).where(eq(customers.id, me.id));
    const actor = { type: "customer" as const, id: me.id, label: me.email };
    const marketing = form.get("marketingEmail") === "on";
    const publication = form.get("publication") === "on";
    const style = z.enum(["first_initial", "initials", "anonymous", "full"]).parse(form.get("displayNameStyle"));
    await db.transaction(async (tx) => {
      if (marketing !== c.marketingEmailConsent) await setConsent(tx, me.id, "marketing_email", marketing, s.privacy.marketingNoticeVersion, "account_preferences", actor);
      if (publication !== c.publicationConsent) await setConsent(tx, me.id, "publication", publication, s.privacy.privacyNoticeVersion, "account_preferences", actor);
      await tx.update(customers).set({ displayNameStyle: style, updatedAt: new Date() }).where(eq(customers.id, me.id));
    });
    return { ok: true, message: "Preferences saved." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Customers may cancel their own FREE bookings; paid bookings are handled by staff under the refund policy. */
export async function cancelMyBooking(_prev: unknown, form: FormData) {
  try {
    const me = await getCustomer();
    if (!me) return { ok: false, error: "Please sign in again." };
    const id = z.string().uuid().parse(form.get("bookingId"));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!b || b.customerId !== me.id) return { ok: false, error: "Booking not found." };
    const [p] = await db.select().from(payments).where(eq(payments.bookingId, id));
    if (p && p.amountPence > 0) return { ok: false, error: "Paid bookings can be moved or refunded by our team — please call or email the store." };
    await cancelBooking(id, { type: "customer", id: me.id, label: me.email }, "Cancelled by customer");
    await sendBookingCancelled(id, "Cancelled at your request");
    return { ok: true, message: "Booking cancelled." };
  } catch (e) {
    return toActionError(e);
  }
}
