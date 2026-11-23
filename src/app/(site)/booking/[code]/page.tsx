import { eq } from "drizzle-orm";
import { CalendarCheck, CheckCircle2, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { BookingStatusPoller } from "@/components/booking-status";
import { FittingPromo } from "@/components/fitting-promo";
import { Alert, Card, LinkButton } from "@/components/ui";
import { db } from "@/db";
import { competitions, customers, payments } from "@/db/schema";
import { formatPence } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { getBookingByCode } from "@/server/bookings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your booking", robots: { index: false } };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ paid?: string; cancelled?: string; new?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const b = await getBookingByCode(code);
  if (!b) notFound();
  const [comp] = await db.select().from(competitions).where(eq(competitions.id, b.competitionId));
  const [cust] = b.customerId ? await db.select({ firstName: customers.firstName }).from(customers).where(eq(customers.id, b.customerId)) : [];
  const [pay] = await db.select().from(payments).where(eq(payments.bookingId, b.id));
  const s = await getSettings();
  const confirmed = ["confirmed", "checked_in", "completed"].includes(b.status);
  const qr = await QRCode.toString(b.checkinCode, { type: "svg", margin: 1, color: { dark: "#003d27", light: "#ffffff" }, errorCorrectionLevel: "M" });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {b.status === "held" && sp.paid && <BookingStatusPoller code={b.checkinCode} />}
      {b.status === "held" && sp.cancelled && <Alert tone="warn" title="Payment not completed">Your slot is held for a few more minutes. Go back to <LinkButton href={`/enter?c=${comp.slug}`} variant="ghost" size="sm">booking</LinkButton> to try again.</Alert>}
      {["expired", "cancelled"].includes(b.status) && (
        <Alert tone="danger" title="This booking is not active">{b.cancelReason ?? "The reservation expired before payment was completed."} If you were charged, a refund is issued automatically.</Alert>
      )}
      <Card className="mt-4 overflow-hidden">
        <div className="bg-turf flex items-center gap-4 px-6 py-6 text-white">
          {confirmed ? <CheckCircle2 className="size-10 text-gold" /> : b.status === "held" ? <CalendarCheck className="size-10 text-gold" /> : <XCircle className="size-10 text-white/60" />}
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{confirmed ? "You're booked in" : b.status === "held" ? "Reserved — awaiting payment" : "Inactive"}</div>
            <h1 className="font-display text-3xl font-bold uppercase">{cust ? `See you soon, ${cust.firstName}` : comp.name}</h1>
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_200px]">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-line pb-3"><dt className="text-muted">Competition</dt><dd className="text-right font-semibold">{comp.name}</dd></div>
            <div className="flex justify-between gap-4 border-b border-line pb-3"><dt className="text-muted">Session</dt><dd className="text-right font-semibold">{formatLocal(b.startsAt, "cccc d LLLL, HH:mm")}</dd></div>
            <div className="flex justify-between gap-4 border-b border-line pb-3"><dt className="text-muted">Rounds</dt><dd className="font-semibold">{b.roundsQty} × {comp.shotsPerRound} shots</dd></div>
            {pay && <div className="flex justify-between gap-4 border-b border-line pb-3"><dt className="text-muted">Payment</dt><dd className="font-semibold">{pay.amountPence ? formatPence(pay.amountPence) : "Free entry"} · {pay.status.replace("_", " ")}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-muted">Booking code</dt><dd className="font-mono text-lg font-bold tracking-[0.2em] text-pine">{b.checkinCode}</dd></div>
          </dl>
          {confirmed && (
            <div className="text-center">
              <div className="mx-auto w-44 rounded-2xl bg-white p-2 ring-1 ring-line" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code for booking ${b.checkinCode}`} role="img" />
              <p className="mt-2 text-xs text-muted">Show this at the counter</p>
            </div>
          )}
        </div>
        <div className="border-t border-line bg-cream/60 px-6 py-4 text-sm text-ink-soft">
          {s.brand.businessName}, {s.store.addressLines}{s.store.postcode ? `, ${s.store.postcode}` : ""}. Please arrive 5 minutes early. {s.booking.noShowPolicy}
        </div>
      </Card>
      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton href={`/leaderboard/${comp.slug}`} variant="secondary">View leaderboard</LinkButton>
        <LinkButton href="/account" variant="ghost">My account</LinkButton>
      </div>
      <div className="mt-16 -mx-4 sm:-mx-6">
        <FittingPromo url={s.links.fittingBookingUrl} business={s.brand.businessName} context="booking_confirmation" competitionId={comp.id} />
      </div>
    </div>
  );
}
