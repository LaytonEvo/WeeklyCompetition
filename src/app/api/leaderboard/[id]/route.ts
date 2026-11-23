import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { PUBLIC_STATUSES } from "@/server/competitions";
import { getPublicLeaderboard } from "@/server/leaderboard";

export const dynamic = "force-dynamic";

/** Public, read-only leaderboard snapshot. Contains no personal contact data. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c || !PUBLIC_STATUSES.includes(c.status)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("versionOnly")) {
    return NextResponse.json({ version: c.leaderboardVersion }, { headers: { "Cache-Control": "no-store" } });
  }
  const s = await getSettings();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || s.leaderboard.publicTopN, 500);
  const etag = `W/"lb-${c.id}-${c.leaderboardVersion}-${limit}"`;
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  const board = await getPublicLeaderboard(c, limit, s.leaderboard.showRoundsCount);
  return NextResponse.json(board, { headers: { ETag: etag, "Cache-Control": "no-cache" } });
}
