import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { competitions, customers, rounds } from "@/db/schema";
import { formatMm } from "@/lib/distance";
import { getSettings } from "@/lib/settings";
import { parseFormat, shareCard } from "@/lib/share-card";
import { formatLocal } from "@/lib/time";
import { publicDisplayName } from "@/server/customers";
import { customerPosition } from "@/server/leaderboard";
import { activeShots, bestOfShots } from "@/server/rounds";

export const dynamic = "force-dynamic";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Shareable result card for a completed round (unguessable round id). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getSettings();
  if (!s.sharing.enabled || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [r] = await db.select().from(rounds).where(eq(rounds.id, id));
  if (!r || r.status !== "completed") return new Response("Not found", { status: 404 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, r.competitionId));
  const [cu] = await db.select().from(customers).where(eq(customers.id, r.customerId));
  const best = bestOfShots(await activeShots(db, r.id), c, cu.id);
  const pos = await customerPosition(c, cu.id);
  return shareCard({
    format: parseFormat(req.nextUrl.searchParams.get("format")),
    variant: "result",
    kicker: c.name,
    name: publicDisplayName(cu),
    headline: best ? formatMm(best.score).replace(" m", "M") : "—",
    sub: pos ? `${pos.tied ? "T" : ""}${ordinal(pos.rank)} on the leaderboard` : undefined,
    footer: `${c.holeName || "Closest to the pin"} · ${formatLocal(r.completedAt ?? r.createdAt, "d LLL yyyy")}`,
    brand: s.brand.businessName,
  });
}
