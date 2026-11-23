import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { competitions, customers, prizeAwards } from "@/db/schema";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { parseFormat, shareCard } from "@/lib/share-card";
import { publicDisplayName } from "@/server/customers";
import { isLaunchApproved } from "@/server/legal";

export const dynamic = "force-dynamic";

/** Winner graphic — only for finalised, non-cancelled awards. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getSettings();
  if (!s.sharing.enabled || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [a] = await db.select().from(prizeAwards).where(eq(prizeAwards.id, id));
  if (!a || a.status === "cancelled" || a.status === "provisional") return new Response("Not found", { status: 404 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, a.competitionId));
  if (!["finalised", "archived"].includes(c.status) && a.kind === "weekly") return new Response("Not found", { status: 404 });
  const [cu] = await db.select().from(customers).where(eq(customers.id, a.customerId));
  const showPrize = (await isLaunchApproved(c)) && a.prizeAmountPence > 0;
  const week = c.sequence ? `WEEK ${String(c.sequence).padStart(2, "0")} WINNER` : `${c.name} winner`;
  return shareCard({
    format: parseFormat(req.nextUrl.searchParams.get("format")),
    variant: a.kind === "jackpot" ? "hio" : "winner",
    kicker: a.kind === "jackpot" ? "Hole-in-one jackpot" : week,
    name: publicDisplayName(cu),
    headline: a.distanceMm !== null ? formatMm(a.distanceMm, a.distanceMm === 0 ? 2 : 2).replace(" m", " METRES").replace("0.00 METRES", "ACE") : "—",
    sub: showPrize ? `${formatPence(a.prizeAmountPence, { compact: true })} WINNER${a.splitWays > 1 ? " (SHARED)" : ""}` : undefined,
    footer: c.name,
    brand: s.brand.businessName,
  });
}
