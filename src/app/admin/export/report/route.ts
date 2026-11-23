import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { computeReport, parseFilters, revenueByWeek, toCsv } from "@/server/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await getStaff();
  if (!u || !can(u.role, "reports.view")) return new NextResponse("Forbidden", { status: 403 });
  const f = parseFilters(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const s = await getSettings();
  const financial = can(u.role, "reports.financial");
  const metrics = (await computeReport(f, s.attribution.fittingWindowDays)).filter((m) => financial || m.format !== "pence");
  const weeks = financial ? await revenueByWeek(f) : [];
  const csv = [
    toCsv(metrics.map((m) => ({ metric: m.label, value: m.value === null ? "" : m.format === "pence" ? (m.value / 100).toFixed(2) : m.value, unit: m.format === "pence" ? "GBP" : m.format, basis: m.basis, note: m.note ?? "" }))),
    "",
    weeks.length ? toCsv(weeks.map((w) => ({ week_commencing: w.week, entries: w.entries, gross_gbp: (Number(w.gross) / 100).toFixed(2) }))) : "",
  ].join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pin-hunters-report.csv"`, "Cache-Control": "no-store" } });
}
