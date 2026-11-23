import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { shotEvidence } from "@/db/schema";
import { getStaff } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { storage, verifyEvidenceSignature } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Serve private evidence: requires a valid short-lived signature AND a signed-in staff user. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const exp = req.nextUrl.searchParams.get("exp") ?? "";
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const staff = await getStaff();
  if (!staff || !can(staff.role, "round.operate")) return new NextResponse("Unauthorised", { status: 401 });
  if (!verifyEvidenceSignature(key, exp, sig)) return new NextResponse("Link expired", { status: 403 });
  const [row] = await db.select().from(shotEvidence).where(eq(shotEvidence.storageKey, key));
  if (!row) return new NextResponse("Not found", { status: 404 });
  const data = await storage().get(key);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": row.contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
