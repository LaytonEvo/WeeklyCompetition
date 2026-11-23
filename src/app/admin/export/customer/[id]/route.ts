import { NextResponse } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { getStaff, staffActor } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { exportCustomerData } from "@/server/customers";

export const dynamic = "force-dynamic";

/** Staff-initiated subject access export. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getStaff();
  if (!u || !can(u.role, "customer.export")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const data = await exportCustomerData(id);
  await audit(db, staffActor(u), "customer.export_json", "customer", id);
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="customer-${id}.json"`, "Cache-Control": "no-store" } });
}
