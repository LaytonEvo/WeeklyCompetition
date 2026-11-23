import { NextResponse } from "next/server";
import { getCustomer } from "@/lib/auth/session";
import { exportCustomerData } from "@/server/customers";

export const dynamic = "force-dynamic";

/** Self-service subject access export (UK GDPR Art. 15/20). */
export async function GET() {
  const me = await getCustomer();
  if (!me) return NextResponse.redirect(new URL("/login?next=/account", process.env.APP_URL ?? "http://localhost:3000"));
  const data = await exportCustomerData(me.id);
  // Staff notes are part of the subject's data and are included.
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pin-hunters-my-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
