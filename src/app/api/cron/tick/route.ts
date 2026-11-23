import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { schedulerTick } from "@/server/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler entry point (Vercel Cron or any external scheduler).
 * Requires `Authorization: Bearer $CRON_SECRET`. Safe to call repeatedly.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const log = await schedulerTick();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), log });
}

export const GET = handle;
export const POST = handle;
