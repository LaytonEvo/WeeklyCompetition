import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookings, payments, rounds, stripeEvents } from "@/db/schema";
import { constructWebhookEvent } from "@/lib/stripe";
import { createBooking, expireHolds } from "@/server/bookings";
import { findOrCreateCustomer } from "@/server/customers";
import { createPendingPayment, processStripeEvent, recordCounterPayment, refundPayment } from "@/server/payments";
import { baseFixture, openComp, person, resetDb, type Fixture } from "../helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await baseFixture();
});
const ctx = { source: "test", termsVersion: "paid-v1", privacyNoticeVersion: "p1", marketingNoticeVersion: "m1" };
const nextSlot = (hours = 2) => new Date(Math.ceil((Date.now() + hours * 3600_000) / 600_000) * 600_000);

async function paidHold(compId: string, startsAt = nextSlot(), holdMinutes = 10) {
  return db.transaction(async (tx) => {
    const { customer } = await findOrCreateCustomer(tx, person(), ctx, { type: "system", label: "test" });
    const booking = await createBooking(tx, { competitionId: compId, customerId: customer.id, startsAt, roundsQty: 1, source: "online", status: "held", holdMinutes }, { type: "system", label: "test" });
    const payment = await createPendingPayment(tx, { customerId: customer.id, competitionId: compId, bookingId: booking.id, roundsQty: 1, amountPence: 500, idempotencyKey: crypto.randomUUID() });
    return { customer, booking, payment };
  });
}

function sessionEvent(type: string, paymentId: string, extra: Record<string, unknown> = {}, id = `evt_${crypto.randomUUID()}`) {
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `cs_test_${paymentId.slice(0, 8)}`, object: "checkout.session", payment_status: "paid", amount_total: 500, payment_intent: `pi_${paymentId.slice(0, 8)}`, metadata: { paymentId }, client_reference_id: paymentId, ...extra } },
  } as unknown as Stripe.Event;
}

describe("double-booking prevention", () => {
  it("only one of many simultaneous requests gets the last place in a slot", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const start = nextSlot();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => paidHold(comp.id, start)));
    const ok = attempts.filter((a) => a.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const failed = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(failed.every((r) => /just been taken|fully booked/.test(String(r.reason)))).toBe(true);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it("an expired hold frees the slot", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const start = nextSlot();
    const first = await paidHold(comp.id, start);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, first.booking.id));
    const second = await paidHold(comp.id, start); // capacity check ignores lapsed holds
    expect(second.booking.id).not.toBe(first.booking.id);
    const expired = await expireHolds();
    expect(expired.map((b) => b.id)).toEqual([first.booking.id]);
    const [p] = await db.select().from(payments).where(eq(payments.id, first.payment.id));
    expect(p.status).toBe("expired");
  });
});

describe("Stripe webhook processing", () => {
  it("verifies signatures", () => {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: {} } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    expect(constructWebhookEvent(payload, header).id).toBe("evt_1");
    expect(() => constructWebhookEvent(payload, "t=1,v1=bad")).toThrow();
    expect(() => constructWebhookEvent(payload.replace("evt_1", "evt_2"), header)).toThrow();
  });

  it("confirms the booking and creates entries exactly once, even if the event is delivered repeatedly", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const { booking, payment } = await paidHold(comp.id);
    const evt = sessionEvent("checkout.session.completed", payment.id);
    const results = await Promise.all([processStripeEvent(evt), processStripeEvent(evt), processStripeEvent(evt)].map((p) => p.catch((e) => ({ outcome: "error", e }))));
    expect(results.filter((r) => r.outcome === "processed")).toHaveLength(1);
    // a second, distinct event for the same session must also be harmless
    await processStripeEvent(sessionEvent("checkout.session.completed", payment.id));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(b.status).toBe("confirmed");
    expect(p.status).toBe("paid");
    expect(p.stripePaymentIntentId).toBe(`pi_${payment.id.slice(0, 8)}`);
    expect(await db.select().from(rounds).where(eq(rounds.paymentId, payment.id))).toHaveLength(1);
    expect((await db.select().from(stripeEvents)).length).toBe(2);
  });

  it("a browser redirect alone never confirms payment (status stays pending until the webhook)", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const { payment, booking } = await paidHold(comp.id);
    const [p] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(p.status).toBe("pending");
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].status).toBe("held");
  });

  it("late payment after hold expiry re-claims a still-free slot", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const { booking, payment } = await paidHold(comp.id);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, booking.id));
    await expireHolds();
    const { effects } = await processStripeEvent(sessionEvent("checkout.session.completed", payment.id));
    expect(effects.refundPaymentIds).toHaveLength(0);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].status).toBe("confirmed");
  });

  it("late payment for a slot that was taken triggers an automatic refund", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const start = nextSlot();
    const first = await paidHold(comp.id, start);
    await db.update(bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, first.booking.id));
    await expireHolds();
    const second = await paidHold(comp.id, start);
    await processStripeEvent(sessionEvent("checkout.session.completed", second.payment.id));
    const { effects } = await processStripeEvent(sessionEvent("checkout.session.completed", first.payment.id));
    expect(effects.refundPaymentIds.map((r) => r.paymentId)).toEqual([first.payment.id]);
    expect((await db.select().from(bookings).where(eq(bookings.id, first.booking.id)))[0].status).toBe("cancelled");
    expect(await db.select().from(rounds).where(eq(rounds.paymentId, first.payment.id))).toHaveLength(0);
  });

  it("handles session expiry and async failure", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const a = await paidHold(comp.id, nextSlot(2));
    await processStripeEvent(sessionEvent("checkout.session.expired", a.payment.id, { payment_status: "unpaid" }));
    expect((await db.select().from(payments).where(eq(payments.id, a.payment.id)))[0].status).toBe("expired");
    expect((await db.select().from(bookings).where(eq(bookings.id, a.booking.id)))[0].status).toBe("expired");
    const b = await paidHold(comp.id, nextSlot(3));
    await processStripeEvent(sessionEvent("checkout.session.completed", b.payment.id, { payment_status: "unpaid" }));
    expect((await db.select().from(payments).where(eq(payments.id, b.payment.id)))[0].status).toBe("pending");
    await processStripeEvent(sessionEvent("checkout.session.async_payment_failed", b.payment.id, { payment_status: "unpaid" }));
    expect((await db.select().from(payments).where(eq(payments.id, b.payment.id)))[0].status).toBe("failed");
  });
});

describe("refunds", () => {
  it("refunds an in-store payment once per idempotency key and cancels unplayed rounds", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const { customer } = await findOrCreateCustomer(db, person(), ctx, f.staffActor);
    const p = await recordCounterPayment(db, { customerId: customer.id, competitionId: comp.id, bookingId: null, roundsQty: 2, method: "card_terminal", amountPence: 1000, reference: "TERM-1", idempotencyKey: crypto.randomUUID() }, f.staffActor);
    await db.insert(rounds).values([1, 2].map(() => ({ competitionId: comp.id, customerId: customer.id, paymentId: p.id, shotsAllowed: 5, status: "booked" as const })));
    await expect(refundPayment(p.id, { amountPence: 2000, reason: "x", idempotencyKey: "k0", cancelUnplayedRounds: 0 }, f.managerActor)).rejects.toThrow(/between/);
    const key = crypto.randomUUID();
    await refundPayment(p.id, { amountPence: 500, reason: "Customer left early", idempotencyKey: key, cancelUnplayedRounds: 1 }, f.managerActor);
    await refundPayment(p.id, { amountPence: 500, reason: "Customer left early", idempotencyKey: key, cancelUnplayedRounds: 1 }, f.managerActor);
    const [after] = await db.select().from(payments).where(eq(payments.id, p.id));
    expect(after).toMatchObject({ refundedPence: 500, status: "partially_refunded" });
    const rs = await db.select().from(rounds).where(eq(rounds.paymentId, p.id));
    expect(rs.filter((r) => r.status === "cancelled")).toHaveLength(1);
  });

  it("requires a reason for complimentary entries", async () => {
    const comp = await openComp(f, { entryMode: "paid", entryFeePence: 500, termsVersion: "paid-v1" });
    const { customer } = await findOrCreateCustomer(db, person(), ctx, f.staffActor);
    await expect(recordCounterPayment(db, { customerId: customer.id, competitionId: comp.id, bookingId: null, roundsQty: 1, method: "complimentary", amountPence: 0, idempotencyKey: crypto.randomUUID() }, f.managerActor)).rejects.toThrow(/reason/);
  });
});
