import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

export interface ReportFilters {
  from: Date;
  to: Date;
  competitionId?: string | null;
  locationId?: string | null;
  source?: string | null;
  customerType?: "new" | "returning" | null;
}

function where(f: ReportFilters, alias = "r") {
  const parts: SQL[] = [sql.raw(`${alias}.created_at >= `).append(sql`${f.from}`), sql.raw(`${alias}.created_at < `).append(sql`${f.to}`)];
  if (f.competitionId) parts.push(sql.raw(`${alias}.competition_id = `).append(sql`${f.competitionId}`));
  if (f.locationId) parts.push(sql`exists (select 1 from competitions cx where cx.id = ${sql.raw(`${alias}.competition_id`)} and cx.location_id = ${f.locationId})`);
  if (f.source) parts.push(sql`exists (select 1 from customers cu where cu.id = ${sql.raw(`${alias}.customer_id`)} and coalesce(cu.utm_source, cu.acquisition_source, 'unknown') = ${f.source})`);
  if (f.customerType === "new") parts.push(sql`exists (select 1 from customers cu where cu.id = ${sql.raw(`${alias}.customer_id`)} and cu.created_at >= ${f.from})`);
  if (f.customerType === "returning") parts.push(sql`exists (select 1 from customers cu where cu.id = ${sql.raw(`${alias}.customer_id`)} and cu.created_at < ${f.from})`);
  return sql.join(parts, sql` and `);
}

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  format: "count" | "pence" | "decimal" | "percent";
  basis: "verified" | "estimate" | "unavailable";
  note?: string;
}

export async function computeReport(f: ReportFilters, attributionDays: number): Promise<Metric[]> {
  const n = async (q: SQL) => Number((await db.execute<{ v: string | number | null }>(q)).rows[0]?.v ?? 0);
  const nOrNull = async (q: SQL) => {
    const v = (await db.execute<{ v: string | number | null }>(q)).rows[0]?.v;
    return v === null || v === undefined ? null : Number(v);
  };
  const roundsLive = sql`r.status not in ('cancelled','voided')`;
  const entries = await n(sql`select count(*) v from rounds r where ${where(f)} and ${roundsLive}`);
  const unique = await n(sql`select count(distinct r.customer_id) v from rounds r where ${where(f)} and ${roundsLive}`);
  const repeat = await n(sql`select count(*) v from (select r.customer_id from rounds r where ${where(f)} and ${roundsLive} group by r.customer_id having count(*) > 1) x`);
  const newCustomers = await n(sql`select count(distinct r.customer_id) v from rounds r join customers c on c.id = r.customer_id where ${where(f)} and ${roundsLive} and c.created_at >= ${f.from}`);
  const gross = await n(sql`select coalesce(sum(r.amount_pence),0) v from payments r where ${where(f)} and r.status in ('paid','paid_in_store','refunded','partially_refunded')`);
  const refundsTotal = await n(sql`select coalesce(sum(rf.amount_pence),0) v from refunds rf join payments r on r.id = rf.payment_id where ${where(f)} and rf.status = 'succeeded'`);
  const fees = await nOrNull(sql`select sum(r.fee_pence) v from payments r where ${where(f)} and r.method = 'stripe' and r.fee_pence is not null`);
  const prizesPaid = await n(sql`select coalesce(sum(r.paid_amount_pence),0) v from prize_awards r where r.paid_at >= ${f.from} and r.paid_at < ${f.to} ${f.competitionId ? sql`and r.competition_id = ${f.competitionId}` : sql``}`);
  const liability = await n(sql`select coalesce(sum(r.prize_amount_pence),0) v from prize_awards r where r.status in ('verified','awaiting_claim','claimed') ${f.competitionId ? sql`and r.competition_id = ${f.competitionId}` : sql``}`);
  const simMinutes = await n(sql`select coalesce(sum(extract(epoch from (r.ends_at - r.starts_at))/60),0) v from bookings r where ${where(f)} and r.status in ('completed','checked_in')`);
  const fittingClicks = await n(sql`select count(*) v from tracking_events r where r.type = 'fitting_cta_click' and r.created_at >= ${f.from} and r.created_at < ${f.to} ${f.competitionId ? sql`and r.competition_id = ${f.competitionId}` : sql``}`);
  // Fitting enquiries/bookings attributable: from customers who entered within the attribution window before the enquiry.
  const attributable = sql`exists (select 1 from rounds rr where rr.customer_id = r.customer_id and rr.status not in ('cancelled','voided') and rr.created_at <= r.created_at and rr.created_at >= r.created_at - make_interval(days => ${attributionDays}))`;
  const fittingEnquiries = await n(sql`select count(*) v from fitting_enquiries r where r.created_at >= ${f.from} and r.created_at < ${f.to} and ${attributable}`);
  const fittingBooked = await n(sql`select count(*) v from fitting_enquiries r where r.created_at >= ${f.from} and r.created_at < ${f.to} and r.status in ('booked','completed') and ${attributable}`);
  const fittingSales = await nOrNull(sql`select sum(r.sale_value_pence) v from fitting_enquiries r where r.created_at >= ${f.from} and r.created_at < ${f.to} and r.sale_value_pence is not null and ${attributable}`);
  const shotsCount = await n(sql`select count(*) v from shots s join rounds r on r.id = s.round_id where ${where(f)} and s.status = 'active'`);
  // Retention: entrants in this period who also entered in the equal-length previous period.
  const len = f.to.getTime() - f.from.getTime();
  const prevFrom = new Date(f.from.getTime() - len);
  const retained = await n(sql`select count(distinct r.customer_id) v from rounds r where ${where(f)} and ${roundsLive} and exists (select 1 from rounds p where p.customer_id = r.customer_id and p.created_at >= ${prevFrom} and p.created_at < ${f.from} and p.status not in ('cancelled','voided'))`);
  const prevUnique = await n(sql`select count(distinct p.customer_id) v from rounds p where p.created_at >= ${prevFrom} and p.created_at < ${f.from} and p.status not in ('cancelled','voided')`);

  const net = gross - refundsTotal;
  return [
    { key: "entries", label: "Total entries (rounds)", value: entries, format: "count", basis: "verified" },
    { key: "unique", label: "Unique entrants", value: unique, format: "count", basis: "verified" },
    { key: "repeat", label: "Repeat entrants (2+ rounds)", value: repeat, format: "count", basis: "verified" },
    { key: "avg_rounds", label: "Average rounds per entrant", value: unique ? Math.round((entries / unique) * 100) / 100 : null, format: "decimal", basis: "verified" },
    { key: "new", label: "New customers", value: newCustomers, format: "count", basis: "verified" },
    { key: "returning", label: "Returning customers", value: unique - newCustomers, format: "count", basis: "verified" },
    { key: "retention", label: "Retention vs previous period", value: prevUnique ? Math.round((retained / prevUnique) * 1000) / 10 : null, format: "percent", basis: "verified", note: `${retained} of ${prevUnique} previous-period entrants returned` },
    { key: "shots", label: "Shots recorded", value: shotsCount, format: "count", basis: "verified" },
    { key: "gross", label: "Gross entry revenue", value: gross, format: "pence", basis: "verified", note: "Gross takings — not profit." },
    { key: "refunds", label: "Refunds", value: refundsTotal, format: "pence", basis: "verified" },
    { key: "net_refunds", label: "Revenue after refunds", value: net, format: "pence", basis: "verified", note: "Before payment fees, prizes, VAT and costs." },
    { key: "fees", label: "Payment processing fees", value: fees, format: "pence", basis: fees === null ? "unavailable" : "verified", note: fees === null ? "Not yet synced from Stripe balance transactions." : undefined },
    { key: "prizes_paid", label: "Prizes paid", value: prizesPaid, format: "pence", basis: "verified" },
    { key: "liability", label: "Outstanding prize liability", value: liability, format: "pence", basis: "verified", note: "Verified but unpaid prizes (all time)." },
    { key: "rev_hour", label: "Revenue per simulator hour", value: simMinutes ? Math.round(net / (simMinutes / 60)) : null, format: "pence", basis: "estimate", note: "Based on booked session length of attended bookings." },
    { key: "fitting_clicks", label: "Fitting CTA clicks", value: fittingClicks, format: "count", basis: "verified" },
    { key: "fitting_enquiries", label: "Fitting enquiries (attributable)", value: fittingEnquiries, format: "count", basis: "estimate", note: `Enquiries from entrants within ${attributionDays} days of an entry.` },
    { key: "fitting_bookings", label: "Fitting bookings (attributable)", value: fittingBooked, format: "count", basis: "estimate" },
    { key: "fitting_sales", label: "Attributable fitting sales", value: fittingSales, format: "pence", basis: fittingSales === null ? "unavailable" : "estimate", note: fittingSales === null ? "Record sale values on fitting enquiries to populate." : undefined },
    { key: "cac", label: "Cost of customer acquisition", value: null, format: "pence", basis: "unavailable", note: "Requires marketing spend data (not connected)." },
  ];
}

export async function revenueByWeek(f: ReportFilters) {
  const res = await db.execute<{ week: string; gross: number; entries: number }>(sql`
    select to_char(date_trunc('week', r.created_at at time zone 'Europe/London'), 'YYYY-MM-DD') week,
      coalesce(sum(r.amount_pence) filter (where r.status in ('paid','paid_in_store','refunded','partially_refunded')),0)::int gross,
      coalesce(sum(r.rounds_qty) filter (where r.status in ('paid','paid_in_store','complimentary','refunded','partially_refunded')),0)::int entries
    from payments r where ${where(f)} group by 1 order by 1`);
  return res.rows;
}

export async function bySource(f: ReportFilters) {
  const res = await db.execute<{ source: string; customers: number; entries: number }>(sql`
    select coalesce(c.utm_source, c.acquisition_source, 'unknown') source, count(distinct c.id)::int customers, count(r.id)::int entries
    from rounds r join customers c on c.id = r.customer_id
    where ${where(f)} and r.status not in ('cancelled','voided') group by 1 order by 3 desc`);
  return res.rows;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
