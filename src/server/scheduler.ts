import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { bookings, payments } from "@/db/schema";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { getStripe } from "@/lib/stripe";
import { expireHolds, sweepNoShows } from "./bookings";
import { applyDueTransitions, autoCreateFromTemplates } from "./competitions";
import { sendBookingReminder } from "./messages";
import { deliverPending } from "./notifications";
import { expireUnclaimedPrizes } from "./results";

/**
 * Periodic maintenance. Every step is idempotent so the tick can be called
 * any number of times (Vercel Cron, an external pinger, or manually).
 */
export async function schedulerTick(now = new Date()) {
  const log: string[] = [];
  const s = await getSettings();

  // 1. Expire unpaid holds (and their Stripe sessions so they can't be paid late).
  const expired = await expireHolds(now);
  if (expired.length) {
    log.push(`expired ${expired.length} hold(s)`);
    const stripe = (() => {
      try {
        return getStripe();
      } catch {
        return null;
      }
    })();
    if (stripe) {
      for (const b of expired) {
        const [p] = await db.select().from(payments).where(eq(payments.bookingId, b.id));
        if (p?.stripeCheckoutSessionId) {
          try {
            await stripe.checkout.sessions.expire(p.stripeCheckoutSessionId);
          } catch {
            /* already completed/expired — webhook handles it */
          }
        }
      }
    }
  }

  // 2. Open / close competitions at their configured times (also applied lazily on access).
  log.push(...(await applyDueTransitions(SYSTEM_ACTOR, now)));

  // 3. Draft upcoming weekly competitions (still require approval).
  const drafted = await autoCreateFromTemplates(SYSTEM_ACTOR, now);
  if (drafted.length) log.push(`drafted ${drafted.length} competition(s) from templates`);

  // 4. Booking reminders.
  const horizon = new Date(now.getTime() + s.booking.reminderHoursBefore * 3600_000);
  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), isNull(bookings.reminderSentAt), gt(bookings.startsAt, now), lt(bookings.startsAt, horizon)));
  for (const b of due) await sendBookingReminder(b.id);
  if (due.length) log.push(`sent ${due.length} reminder(s)`);

  // 5. No-shows, unclaimed prizes, email retries.
  const noShows = await sweepNoShows(s.booking.lateArrivalGraceMinutes, now);
  if (noShows.length) log.push(`marked ${noShows.length} no-show(s)`);
  const expiredPrizes = await expireUnclaimedPrizes(now);
  if (expiredPrizes.length) log.push(`expired ${expiredPrizes.length} unclaimed prize(s)`);
  const retried = await deliverPending();
  if (retried) log.push(`delivered ${retried} queued email(s)`);

  return log;
}
