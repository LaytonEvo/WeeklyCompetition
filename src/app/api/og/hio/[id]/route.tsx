import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { competitions, customers, hioClaims, shots } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { parseFormat, shareCard } from "@/lib/share-card";
import { formatLocal } from "@/lib/time";
import { publicDisplayName } from "@/server/customers";

export const dynamic = "force-dynamic";

/** Hole-in-one graphic — approved claims only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getSettings();
  if (!s.sharing.enabled || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [h] = await db.select().from(hioClaims).where(eq(hioClaims.id, id));
  if (!h || h.status !== "approved") return new Response("Not found", { status: 404 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, h.competitionId));
  const [cu] = await db.select().from(customers).where(eq(customers.id, h.customerId));
  const [sh] = await db.select().from(shots).where(eq(shots.id, h.shotId));
  return shareCard({
    format: parseFormat(req.nextUrl.searchParams.get("format")),
    variant: "hio",
    kicker: "Hole-in-one",
    name: cu.publicationConsent ? publicDisplayName(cu) : publicDisplayName({ ...cu, displayNameStyle: "first_initial" }),
    headline: "ACE",
    sub: c.holeName || undefined,
    footer: `${c.name} · ${formatLocal(sh.recordedAt, "d LLL yyyy")}`,
    brand: s.brand.businessName,
  });
}
