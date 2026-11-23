import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { trackingEvents } from "@/db/schema";
import { getCustomer } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Click-tracked redirect to the (configurable) fitting booking page. */
export async function GET(req: NextRequest) {
  const s = await getSettings();
  const p = req.nextUrl.searchParams;
  const competitionId = p.get("c");
  const customer = await getCustomer().catch(() => null);
  await db
    .insert(trackingEvents)
    .values({
      type: "fitting_cta_click",
      context: (p.get("src") ?? "unknown").slice(0, 64),
      competitionId: competitionId && /^[0-9a-f-]{36}$/i.test(competitionId) ? competitionId : null,
      customerId: customer?.id ?? null,
      utmSource: p.get("utm_source"),
      utmMedium: p.get("utm_medium"),
      utmCampaign: p.get("utm_campaign"),
    })
    .catch((e) => console.error("[track]", e));
  const target = s.links.fittingBookingUrl || "/fitting";
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), 302);
}
