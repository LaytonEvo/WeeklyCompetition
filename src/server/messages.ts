import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, competitions, customers, payments, prizeAwards, rounds } from "@/db/schema";
import { formatMm } from "@/lib/distance";
import type { EmailContent } from "@/lib/email/templates";
import { formatPence } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { customerPosition } from "./leaderboard";
import { activeShots, bestOfShots } from "./rounds";
import { sendEmail } from "./notifications";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const fittingHref = (ctx: string, competitionId?: string) => `${appUrl()}/go/fitting?src=${ctx}${competitionId ? `&c=${competitionId}` : ""}`;

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function load(bookingId: string) {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b?.customerId) return null;
  const [c] = await db.select().from(customers).where(eq(customers.id, b.customerId));
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, b.competitionId));
  return { b, c, comp };
}

export async function sendMagicLink(to: string, url: string, customerId: string | null, nonce: string) {
  return sendEmail({
    type: "magic_link",
    customerId,
    to,
    dedupeKey: `magic_link:${nonce}`,
    content: {
      subject: "Your Pin Hunters sign-in link",
      heading: "Sign in to Pin Hunters",
      blocks: [
        { p: "Tap the button below to sign in. This link works once and expires in 20 minutes." },
        { button: "Sign in", href: url },
        { note: "If you didn't request this, you can ignore this email." },
      ],
    },
  });
}

export async function sendBookingConfirmation(bookingId: string) {
  const x = await load(bookingId);
  if (!x || x.c.anonymisedAt) return;
  const [pay] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
  const s = await getSettings();
  const rows: [string, string][] = [
    ["Competition", x.comp.name],
    ["Session", formatLocal(x.b.startsAt, "cccc d LLLL, HH:mm")],
    ["Rounds", `${x.b.roundsQty} × ${x.comp.shotsPerRound} shots`],
    ["Booking code", x.b.checkinCode],
  ];
  if (pay && pay.amountPence > 0) rows.push(["Paid", `${formatPence(pay.amountPence)}${pay.method === "stripe" ? " (card)" : ""}`]);
  return sendEmail({
    type: "booking_confirmation",
    customerId: x.c.id,
    to: x.c.email,
    dedupeKey: `booking_confirmation:${bookingId}`,
    content: {
      subject: `You're booked in — ${x.comp.name}`,
      heading: "Your session is confirmed",
      greeting: `Hi ${x.c.firstName},`,
      blocks: [
        { p: `See you at ${s.brand.businessName}${s.store.addressLines ? `, ${s.store.addressLines}` : ""}. Please arrive 5 minutes early and show your booking code or QR at the counter.` },
        { rows },
        { button: "View booking & QR code", href: `${appUrl()}/booking/${x.b.checkinCode}` },
        { note: s.booking.noShowPolicy },
      ],
    },
  });
}

export async function sendBookingReminder(bookingId: string) {
  const x = await load(bookingId);
  if (!x || x.c.anonymisedAt) return;
  await sendEmail({
    type: "booking_reminder",
    customerId: x.c.id,
    to: x.c.email,
    dedupeKey: `booking_reminder:${bookingId}:${x.b.startsAt.toISOString()}`,
    content: {
      subject: `Reminder: Pin Hunters ${formatLocal(x.b.startsAt, "ccc HH:mm")}`,
      heading: "Your Pin Hunters session is coming up",
      greeting: `Hi ${x.c.firstName},`,
      blocks: [
        { rows: [["Session", formatLocal(x.b.startsAt, "cccc d LLLL, HH:mm")], ["Booking code", x.b.checkinCode]] },
        { button: "View booking", href: `${appUrl()}/booking/${x.b.checkinCode}` },
      ],
    },
  });
  await db.update(bookings).set({ reminderSentAt: new Date() }).where(eq(bookings.id, bookingId));
}

export async function sendBookingCancelled(bookingId: string, reason: string) {
  const x = await load(bookingId);
  if (!x || x.c.anonymisedAt) return;
  return sendEmail({
    type: "booking_cancelled",
    customerId: x.c.id,
    to: x.c.email,
    dedupeKey: `booking_cancelled:${bookingId}`,
    content: {
      subject: "Your Pin Hunters booking has been cancelled",
      heading: "Booking cancelled",
      greeting: `Hi ${x.c.firstName},`,
      blocks: [
        { p: `Your session on ${formatLocal(x.b.startsAt, "cccc d LLLL 'at' HH:mm")} has been cancelled.` },
        { p: `Reason: ${reason}` },
        { note: "If you paid online, any refund will be confirmed separately and usually appears within 5–10 working days." },
      ],
    },
  });
}

export async function sendPaymentProblem(bookingId: string, message: string) {
  const x = await load(bookingId);
  if (!x || x.c.anonymisedAt) return;
  return sendEmail({
    type: "payment_problem",
    customerId: x.c.id,
    to: x.c.email,
    dedupeKey: `payment_problem:${bookingId}`,
    content: {
      subject: "About your Pin Hunters payment",
      heading: "We couldn't confirm your session",
      greeting: `Hi ${x.c.firstName},`,
      blocks: [{ p: message }, { button: "Choose another session", href: `${appUrl()}/enter` }],
    },
  });
}

export async function sendRefundIssued(paymentId: string, amountPence: number, refundId: string) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p?.customerId) return;
  const [c] = await db.select().from(customers).where(eq(customers.id, p.customerId));
  if (!c || c.anonymisedAt) return;
  return sendEmail({
    type: "refund_issued",
    customerId: c.id,
    to: c.email,
    dedupeKey: `refund:${refundId}`,
    content: {
      subject: "Your Pin Hunters refund",
      heading: "Refund issued",
      greeting: `Hi ${c.firstName},`,
      blocks: [{ p: `We've issued a refund of ${formatPence(amountPence)}. It usually appears on your statement within 5–10 working days.` }],
    },
  });
}

/** Round summary with best shot, position, personal-best flag and fitting CTA. */
export async function sendRoundSummary(roundId: string) {
  const [r] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!r || r.status !== "completed") return;
  const [c] = await db.select().from(customers).where(eq(customers.id, r.customerId));
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, r.competitionId));
  if (!c || c.anonymisedAt) return;
  const s = await getSettings();
  const shotRows = await activeShots(db, roundId);
  const best = bestOfShots(shotRows, comp, c.id);
  const pos = await customerPosition(comp, c.id);

  // Personal best across this competition's other completed rounds.
  const others = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.customerId, c.id), eq(rounds.competitionId, comp.id), eq(rounds.status, "completed")));
  let previousBest: number | null = null;
  for (const o of others.filter((o) => o.id !== roundId)) {
    const b = bestOfShots(await activeShots(db, o.id), comp, c.id);
    if (b && (previousBest === null || b.score < previousBest)) previousBest = b.score;
  }
  const isPb = best !== null && previousBest !== null && best.score < previousBest;
  const hio = shotRows.some((x) => x.isHoleInOne);

  const blocks: EmailContent["blocks"] = [{ p: `Thanks for taking part in ${s.brand.competitionName}.` }];
  if (best) blocks.push({ big: formatMm(best.score).replace(" m", " metres"), caption: isPb ? "New personal best!" : "Your best shot this round" });
  else blocks.push({ p: "None of this round's shots qualified for the leaderboard this time — there's still time to have another go." });
  if (hio) blocks.push({ p: "Your hole-in-one claim is being verified by our team. We'll email you as soon as a decision is made." });
  if (pos) blocks.push({ rows: [["Current leaderboard position", `${ordinal(pos.rank)}${pos.tied ? " (tied)" : ""} of ${pos.of}`], ["Competition closes", formatLocal(comp.endsAt, "ccc d LLL, HH:mm")]] });
  blocks.push({ button: "View the leaderboard", href: `${appUrl()}/leaderboard/${comp.slug}` });
  blocks.push({ p: "Want to improve your score? There are sessions available for the rest of the competition." });
  blocks.push({ button: "Book another session", href: `${appUrl()}/enter?c=${comp.slug}` });

  await sendEmail({
    type: isPb ? "round_summary_pb" : "round_summary",
    customerId: c.id,
    to: c.email,
    dedupeKey: `round_summary:${roundId}`,
    content: {
      subject: isPb ? `New personal best! Your ${s.brand.competitionName} result` : `Your ${s.brand.competitionName} Result — ${s.brand.businessName}`,
      heading: isPb ? "New personal best" : "Your result is in",
      greeting: `Hi ${c.firstName},`,
      blocks,
      fittingCta: s.links.fittingBookingUrl ? { href: fittingHref("email_round", comp.id), text: "Interested in finding the right clubs for your game?" } : null,
    },
  });
  await db.update(rounds).set({ resultEmailSentAt: new Date() }).where(eq(rounds.id, roundId));
}

export async function sendHioUpdate(claimId: string, customerId: string, approved: boolean, jackpot: { eligible: boolean; amountPence: number; reason?: string }) {
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!c || c.anonymisedAt) return;
  const blocks: EmailContent["blocks"] = approved
    ? [
        { p: "Congratulations — our team has verified your hole-in-one." },
        jackpot.eligible
          ? { p: `You qualify for the hole-in-one jackpot of ${formatPence(jackpot.amountPence)}. We'll be in touch about collecting your prize; you may be asked for photo ID.` }
          : { p: `Under the published rules this hole-in-one does not qualify for the jackpot (${jackpot.reason ?? "see rules"}). It still counts as a perfect score.` },
      ]
    : [{ p: "After reviewing the evidence we weren't able to verify the hole-in-one claim. Your other shots still count. If you'd like to discuss the decision, reply to this email or speak to a manager in store." }];
  return sendEmail({
    type: "hio_update",
    customerId,
    to: c.email,
    dedupeKey: `hio_update:${claimId}`,
    content: { subject: approved ? "Hole-in-one verified!" : "Update on your hole-in-one claim", heading: approved ? "Hole-in-one verified" : "Hole-in-one claim update", greeting: `Hi ${c.firstName},`, blocks },
  });
}

export async function sendWinnerNotification(awardId: string, kind: "provisional" | "official") {
  const [a] = await db.select().from(prizeAwards).where(eq(prizeAwards.id, awardId));
  if (!a) return;
  const [c] = await db.select().from(customers).where(eq(customers.id, a.customerId));
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, a.competitionId));
  if (!c || c.anonymisedAt) return;
  const s = await getSettings();
  const blocks: EmailContent["blocks"] =
    kind === "provisional"
      ? [
          { p: `You're currently in a winning position in ${comp.name}. Results are provisional until our team has completed verification.` },
          { big: a.distanceMm !== null ? formatMm(a.distanceMm) : "—", caption: `Provisional position ${a.rank ?? ""}` },
        ]
      : [
          { p: `Congratulations! You've officially won ${a.kind === "jackpot" ? "the hole-in-one jackpot" : `position ${a.rank}`} in ${comp.name}.` },
          { rows: [["Prize", a.prizeAmountPence > 0 ? formatPence(a.prizeAmountPence) : a.prizeDescription], ["Winning distance", a.distanceMm !== null ? formatMm(a.distanceMm) : "—"], ["Claim by", formatLocal(a.claimDeadline, "d LLLL yyyy")]] },
          { p: `How to claim: visit ${s.brand.businessName} or reply to this email before the claim deadline. Please bring photo ID matching your entry details. Prizes are paid by bank transfer or in store as set out in the competition rules.` },
        ];
  await sendEmail({
    type: kind === "provisional" ? "winner_provisional" : "winner_official",
    customerId: c.id,
    to: c.email,
    dedupeKey: `winner_${kind}:${awardId}`,
    content: { subject: kind === "provisional" ? `You're in the lead — ${comp.name}` : `You're a winner — ${comp.name}`, heading: kind === "provisional" ? "Provisional result" : "Official winner", greeting: `Hi ${c.firstName},`, blocks },
  });
  if (kind === "official") await db.update(prizeAwards).set({ notificationStatus: "sent" }).where(eq(prizeAwards.id, awardId));
}

/** Material rule change or cancellation: notify everyone with an active entry. */
export async function notifyEntrants(competitionId: string, kind: "cancelled" | "changed", message: string, versionKey: string) {
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  const entrants = await db
    .selectDistinct({ id: customers.id, email: customers.email, firstName: customers.firstName })
    .from(rounds)
    .innerJoin(customers, eq(customers.id, rounds.customerId))
    .where(and(eq(rounds.competitionId, competitionId), inArray(rounds.status, ["booked", "checked_in", "in_progress", "paused", "completed"])));
  for (const e of entrants) {
    await sendEmail({
      type: kind === "cancelled" ? "competition_cancelled" : "competition_changed",
      customerId: e.id,
      to: e.email,
      dedupeKey: `competition_${kind}:${competitionId}:${versionKey}:${e.id}`,
      content: {
        subject: kind === "cancelled" ? `${comp.name} has been cancelled` : `Important update to ${comp.name}`,
        heading: kind === "cancelled" ? "Competition cancelled" : "Competition rules updated",
        greeting: `Hi ${e.firstName},`,
        blocks: [
          { p: message },
          kind === "cancelled"
            ? { p: "Unplayed paid entries will be refunded. If you have any questions please contact the store." }
            : { button: "Read the updated rules", href: `${appUrl()}/competitions/${comp.slug}` },
        ],
      },
    });
  }
  return entrants.length;
}

