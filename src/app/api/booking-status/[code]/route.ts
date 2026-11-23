import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, payments } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Status poll for the confirmation page while waiting for the Stripe webhook. Code is an unguessable bearer reference. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const [b] = await db.select().from(bookings).where(eq(bookings.checkinCode, code.toUpperCase()));
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.bookingId, b.id));
  return NextResponse.json({ booking: b.status, payment: p?.status ?? null }, { headers: { "Cache-Control": "no-store" } });
}
