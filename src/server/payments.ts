import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type DbOrTx } from "@/db";
import { bookings, competitions, payments, refunds, rounds, simulators, stripeEvents } from "@/db/schema";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { getStripe } from "@/lib/stripe";
import { lockSimulator, overlappingCount } from "./availability";
import { createRoundsForPayment } from "./bookings";

export type Payment = typeof payments.$inferSelect;

/** Create the pending payment record for an online paid booking. Idempotent per client key. */
export async function createPendingPayment(
  tx: DbOrTx,
  opts: { customerId: string; competitionId: string; bookingId: string; roundsQty: number; amountPence: number; idempotencyKey: string },
) {
  const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, opts.idempotencyKey));
  if (existing) return existing;
  const [p] = await tx
    .insert(payments)
    .values({ ...opts, method: "stripe", status: "pending" })
    .returning();
  return p;
}

/**
 * Create a Stripe Checkout Session for a pending payment. Card data is
 * handled entirely by Stripe-hosted Checkout; we never see it.
 */
export async function createCheckoutSession(paymentId: string, opts: { customerEmail: string; competitionName: string; unitAmountPence: number; holdExpiresAt: Date; successUrl: string; cancelUrl: string }) {
  const stripe = getStripe();
  if (!stripe) throw new AppError("Online payments are not configured yet. Please book in store.");
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  // Stripe requires expires_at ≥ 30 minutes; our own hold may be shorter — a late payment
  // against an expired hold is handled in the webhook (re-claim the slot or refund).
  const expiresAt = Math.max(Math.floor(opts.holdExpiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 31 * 60);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: opts.customerEmail,
      line_items: [
        {
          quantity: p.roundsQty,
          price_data: { currency: "gbp", unit_amount: opts.unitAmountPence, product_data: { name: `${opts.competitionName} — competition round` } },
        },
      ],
      metadata: { paymentId: p.id, bookingId: p.bookingId ?? "", competitionId: p.competitionId },
      payment_intent_data: { metadata: { paymentId: p.id } },
      client_reference_id: p.id,
      expires_at: expiresAt,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    { idempotencyKey: `checkout:${p.id}` },
  );
  await db.update(payments).set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(eq(payments.id, p.id));
  return session;
}

type WebhookOutcome = "processed" | "duplicate" | "ignored";

export interface WebhookSideEffects {
  confirmedBookingIds: string[];
  refundPaymentIds: { paymentId: string; reason: string; bookingId: string | null }[];
}

/**
 * Process a verified Stripe event exactly once. The event id is recorded in
 * the same transaction as its effects; if processing throws, both roll back
 * and Stripe's retry will be processed cleanly.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<{ outcome: WebhookOutcome; effects: WebhookSideEffects }> {
  const effects: WebhookSideEffects = { confirmedBookingIds: [], refundPaymentIds: [] };
  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type, payload: { id: event.id, type: event.type, created: event.created } })
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) return "duplicate" as const;

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status !== "paid") return "ignored" as const; // async methods complete later
        await markPaid(tx, session, effects);
        return "processed" as const;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const p = await paymentForSession(tx, session);
        if (!p || p.status !== "pending") return "ignored" as const;
        await tx.update(payments).set({ status: "expired", updatedAt: new Date() }).where(eq(payments.id, p.id));
        if (p.bookingId) await tx.update(bookings).set({ status: "expired", updatedAt: new Date() }).where(and(eq(bookings.id, p.bookingId), eq(bookings.status, "held")));
        return "processed" as const;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const p = await paymentForSession(tx, session);
        if (!p) return "ignored" as const;
        await tx.update(payments).set({ status: "failed", failureReason: "Async payment failed", updatedAt: new Date() }).where(eq(payments.id, p.id));
        if (p.bookingId) await tx.update(bookings).set({ status: "cancelled", cancelReason: "Payment failed", updatedAt: new Date() }).where(and(eq(bookings.id, p.bookingId), eq(bookings.status, "held")));
        return "processed" as const;
      }
      case "charge.refunded": {
        // Keeps our record in sync with refunds made directly in the Stripe dashboard.
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!piId) return "ignored" as const;
        const [p] = await tx.select().from(payments).where(eq(payments.stripePaymentIntentId, piId)).for("update");
        if (!p) return "ignored" as const;
        const refunded = charge.amount_refunded;
        await tx
          .update(payments)
          .set({ refundedPence: refunded, status: refunded >= p.amountPence ? "refunded" : "partially_refunded", updatedAt: new Date() })
          .where(eq(payments.id, p.id));
        await audit(tx, SYSTEM_ACTOR, "payment.refund_synced", "payment", p.id, { after: { refunded } });
        return "processed" as const;
      }
      default:
        return "ignored" as const;
    }
  });
  return { outcome, effects };
}

async function paymentForSession(tx: DbOrTx, session: Stripe.Checkout.Session) {
  const id = session.metadata?.paymentId || session.client_reference_id;
  if (!id) return null;
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  return p ?? null;
}

async function markPaid(tx: DbOrTx, session: Stripe.Checkout.Session, effects: WebhookSideEffects) {
  const p = await paymentForSession(tx, session);
  if (!p) throw new Error(`Payment not found for checkout session ${session.id}`);
  if (session.amount_total !== null && session.amount_total !== p.amountPence) {
    // Never silently accept a mismatched amount.
    await audit(tx, SYSTEM_ACTOR, "payment.amount_mismatch", "payment", p.id, { after: { expected: p.amountPence, received: session.amount_total } });
  }
  if (["paid", "refunded", "partially_refunded"].includes(p.status)) return; // already handled
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  await tx
    .update(payments)
    .set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: piId, stripeCheckoutSessionId: session.id, updatedAt: new Date() })
    .where(eq(payments.id, p.id));
  await audit(tx, SYSTEM_ACTOR, "payment.paid", "payment", p.id, { after: { session: session.id, amount: session.amount_total } });

  if (!p.bookingId || !p.customerId) return;
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for("update");
  const [c] = await tx.select().from(competitions).where(eq(competitions.id, p.competitionId));
  const [sim] = await tx.select().from(simulators).where(eq(simulators.id, b.simulatorId));

  const refund = (reason: string) => effects.refundPaymentIds.push({ paymentId: p.id, reason, bookingId: b.id });

  if (b.status === "held" || b.status === "expired") {
    // If the hold lapsed, re-claim the slot if it is still free; otherwise refund automatically.
    await lockSimulator(tx, sim.id);
    const used = await overlappingCount(tx, sim.id, b.startsAt, b.endsAt, new Date(), b.id);
    const competitionOpen = ["scheduled", "open"].includes(c.status) && b.startsAt < c.endsAt;
    if (used >= sim.slotCapacity || !competitionOpen || b.startsAt < new Date()) {
      await tx.update(bookings).set({ status: "cancelled", cancelReason: "Slot no longer available when payment completed — auto refund", updatedAt: new Date() }).where(eq(bookings.id, b.id));
      refund(competitionOpen ? "Your reserved time expired before payment completed and has since been taken." : "The competition was no longer accepting entries when your payment completed.");
      return;
    }
    await tx.update(bookings).set({ status: "confirmed", holdExpiresAt: null, updatedAt: new Date() }).where(eq(bookings.id, b.id));
    await createRoundsForPayment(tx, { booking: b, paymentId: p.id, customerId: p.customerId, competition: c, qty: p.roundsQty });
    effects.confirmedBookingIds.push(b.id);
    return;
  }
  if (b.status === "confirmed") {
    await createRoundsForPayment(tx, { booking: b, paymentId: p.id, customerId: p.customerId, competition: c, qty: p.roundsQty });
    return;
  }
  // Booking was cancelled while the customer was paying.
  refund("Your booking was cancelled before the payment completed.");
}

/**
 * Refund a payment (fully or partly). Stripe refunds use an idempotency key
 * so double-clicks never refund twice. Optionally cancels unplayed rounds.
 */
export async function refundPayment(
  paymentId: string,
  opts: { amountPence: number; reason: string; idempotencyKey: string; cancelUnplayedRounds: number },
  actor: Actor,
) {
  if (!opts.reason.trim()) throw new AppError("A refund reason is required.");
  const prior = await db.select().from(refunds).where(eq(refunds.idempotencyKey, opts.idempotencyKey));
  if (prior.length) return prior[0];

  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw new NotFoundError("Payment");
  if (!["paid", "paid_in_store", "partially_refunded"].includes(p.status)) throw new ConflictError(`A ${p.status.replaceAll("_", " ")} payment can't be refunded.`);
  const refundable = p.amountPence - p.refundedPence;
  if (!Number.isInteger(opts.amountPence) || opts.amountPence <= 0 || opts.amountPence > refundable) throw new AppError(`Refund must be between 1p and ${refundable}p.`);

  let stripeRefundId: string | null = null;
  if (p.method === "stripe") {
    const stripe = getStripe();
    if (!stripe) throw new AppError("Stripe is not configured, so this card payment can't be refunded here. Refund it in the Stripe dashboard.");
    if (!p.stripePaymentIntentId) throw new ConflictError("No Stripe payment intent recorded for this payment.");
    const r = await stripe.refunds.create(
      { payment_intent: p.stripePaymentIntentId, amount: opts.amountPence, metadata: { paymentId, reason: opts.reason.slice(0, 400) } },
      { idempotencyKey: `refund:${opts.idempotencyKey}` },
    );
    stripeRefundId = r.id;
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    const [row] = await tx
      .insert(refunds)
      .values({
        paymentId,
        amountPence: opts.amountPence,
        reason: opts.reason,
        status: "succeeded",
        stripeRefundId,
        idempotencyKey: opts.idempotencyKey,
        createdByUserId: actor.type === "user" ? actor.id : null,
      })
      .onConflictDoNothing({ target: refunds.idempotencyKey })
      .returning();
    if (!row) return (await tx.select().from(refunds).where(eq(refunds.idempotencyKey, opts.idempotencyKey)))[0];
    const total = locked.refundedPence + opts.amountPence;
    await tx
      .update(payments)
      .set({ refundedPence: total, status: total >= locked.amountPence ? "refunded" : "partially_refunded", updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
    if (opts.cancelUnplayedRounds > 0) {
      const unplayed = await tx
        .select({ id: rounds.id })
        .from(rounds)
        .where(and(eq(rounds.paymentId, paymentId), inArray(rounds.status, ["booked", "checked_in"])))
        .limit(opts.cancelUnplayedRounds);
      if (unplayed.length) {
        await tx
          .update(rounds)
          .set({ status: "cancelled", statusReason: `Refunded: ${opts.reason}`, updatedAt: new Date() })
          .where(inArray(rounds.id, unplayed.map((u) => u.id)));
      }
    }
    await audit(tx, actor, "payment.refund", "payment", paymentId, { after: { amountPence: opts.amountPence, stripeRefundId }, reason: opts.reason });
    return row;
  });
}

/** In-store (counter) payment or authorised free/complimentary entry. */
export async function recordCounterPayment(
  tx: DbOrTx,
  opts: {
    customerId: string;
    competitionId: string;
    bookingId: string | null;
    roundsQty: number;
    method: "card_terminal" | "cash" | "complimentary" | "free_entry";
    amountPence: number;
    reference?: string | null;
    authorisationReason?: string | null;
    idempotencyKey: string;
  },
  actor: Actor & { type: "user" },
) {
  const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, opts.idempotencyKey));
  if (existing) return existing;
  const status = opts.method === "complimentary" || opts.method === "free_entry" ? "complimentary" : "paid_in_store";
  if (status === "paid_in_store" && opts.amountPence <= 0) throw new AppError("Enter the amount taken.");
  if (opts.method === "complimentary" && !opts.authorisationReason?.trim()) throw new AppError("Give a reason for a complimentary entry.");
  const [p] = await tx
    .insert(payments)
    .values({
      customerId: opts.customerId,
      competitionId: opts.competitionId,
      bookingId: opts.bookingId,
      roundsQty: opts.roundsQty,
      method: opts.method,
      status,
      amountPence: status === "complimentary" ? 0 : opts.amountPence,
      reference: opts.reference ?? null,
      authorisationReason: opts.authorisationReason ?? null,
      idempotencyKey: opts.idempotencyKey,
      recordedByUserId: actor.id,
      paidAt: new Date(),
    })
    .returning();
  await audit(tx, actor, `payment.${opts.method}`, "payment", p.id, { after: { amountPence: p.amountPence, roundsQty: p.roundsQty, reference: p.reference }, reason: opts.authorisationReason ?? null });
  return p;
}

/** Reconciliation: Stripe payments that look inconsistent with entries. */
export async function reconciliationIssues() {
  const res = await db.execute<{ id: string; status: string; issue: string; amount_pence: number; created_at: Date }>(sql`
    select p.id, p.status, p.amount_pence, p.created_at,
      case
        when p.status = 'paid' and p.booking_id is not null and (select count(*) from rounds r where r.payment_id = p.id) = 0 then 'Paid but no entries created'
        when p.status = 'paid' and exists (select 1 from bookings b where b.id = p.booking_id and b.status in ('cancelled','expired')) then 'Paid but booking cancelled/expired — check refund'
        when p.status = 'pending' and p.created_at < now() - interval '2 hours' then 'Pending for over 2 hours'
        when p.status in ('paid','paid_in_store') and (select count(*) from rounds r where r.payment_id = p.id and r.restart_of_round_id is null) <> p.rounds_qty then 'Rounds count does not match rounds purchased'
      end as issue
    from payments p
    where p.method in ('stripe','card_terminal','cash')
  `);
  return res.rows.filter((r) => r.issue);
}
