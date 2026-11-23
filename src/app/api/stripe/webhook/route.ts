import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { constructWebhookEvent } from "@/lib/stripe";
import { cancelBooking } from "@/server/bookings";
import { sendBookingConfirmation, sendPaymentProblem, sendRefundIssued } from "@/server/messages";
import { processStripeEvent, refundPayment } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Payment is ONLY confirmed here (never from the browser
 * redirect). Signature-verified; processing is idempotent per event id.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = constructWebhookEvent(raw, req.headers.get("stripe-signature"));
  } catch (e) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${(e as Error).message}` }, { status: 400 });
  }
  try {
    const { outcome, effects } = await processStripeEvent(event);
    // Side effects after commit. Failures here are logged and retried by staff/cron; they never undo the payment record.
    for (const bookingId of effects.confirmedBookingIds) await sendBookingConfirmation(bookingId).catch((e) => console.error("[webhook] confirmation email", e));
    for (const r of effects.refundPaymentIds) {
      try {
        const refund = await refundPayment(r.paymentId, { amountPence: await fullAmount(r.paymentId), reason: r.reason, idempotencyKey: `auto:${r.paymentId}`, cancelUnplayedRounds: 0 }, SYSTEM_ACTOR);
        if (r.bookingId) await sendPaymentProblem(r.bookingId, `${r.reason} We've refunded your payment in full — please choose another session.`);
        if (refund) await sendRefundIssued(r.paymentId, refund.amountPence, refund.id);
      } catch (e) {
        console.error("[webhook] automatic refund failed — appears in Payments › Reconciliation", e);
        if (r.bookingId) await cancelBooking(r.bookingId, SYSTEM_ACTOR, "Auto-refund pending").catch(() => undefined);
      }
    }
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error("[webhook] processing failed", e);
    // 500 → Stripe retries with backoff; the event row was rolled back so the retry is processed cleanly.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

async function fullAmount(paymentId: string) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return p.amountPence - p.refundedPence;
}
