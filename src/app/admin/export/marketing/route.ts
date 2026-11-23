import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getStaff, staffActor } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { toCsv } from "@/server/reports";

export const dynamic = "force-dynamic";

/**
 * Marketing audience export — ONLY customers with current, recorded email
 * marketing consent. For import into a CRM/Klaviyo (no integration is connected).
 */
export async function GET() {
  const u = await getStaff();
  if (!u || !can(u.role, "marketing.export_consented")) return new NextResponse("Forbidden", { status: 403 });
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.marketingEmailConsent, true), isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));
  await audit(db, staffActor(u), "marketing.export", "customer", null, { after: { count: rows.length } });
  const csv = toCsv(rows.map((c) => ({ email: c.email, first_name: c.firstName, last_name: c.lastName, consent: "email_marketing", source: c.utmSource ?? c.acquisitionSource ?? "", fitting_interest: c.fittingInterest })));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="marketing-consented.csv"`, "Cache-Control": "no-store" } });
}
