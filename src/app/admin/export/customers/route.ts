import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { getStaff, staffActor } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { listCustomers } from "@/server/customer-admin";
import { toCsv } from "@/server/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await getStaff();
  if (!u || !can(u.role, "customer.export")) return new NextResponse("Forbidden", { status: 403 });
  const rows = await listCustomers({ q: req.nextUrl.searchParams.get("q") ?? undefined, filter: req.nextUrl.searchParams.get("filter") ?? undefined, limit: 50_000 });
  await audit(db, staffActor(u), "customer.export_csv", "customer", null, { after: { count: rows.length } });
  const csv = toCsv(
    rows.filter((r) => !r.c.anonymisedAt).map(({ c, rounds }) => ({
      id: c.id, first_name: c.firstName, last_name: c.lastName, email: c.email, mobile: c.mobile, handicap: c.handicap, home_club: c.homeClub,
      marketing_email_consent: c.marketingEmailConsent, fitting_interest: c.fittingInterest, source: c.utmSource ?? c.acquisitionSource, campaign: c.utmCampaign, rounds, created_at: c.createdAt,
    })),
  );
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="customers.csv"`, "Cache-Control": "no-store" } });
}
