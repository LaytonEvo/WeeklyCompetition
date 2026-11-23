import { desc } from "drizzle-orm";
import { DateTime } from "luxon";
import { Badge, Card, CardHeader, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { competitions, locations } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { DEFAULT_TZ } from "@/lib/time";
import { bySource, computeReport, parseFilters, revenueByWeek } from "@/server/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };


export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaffPage("reports.view");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const s = await getSettings();
  const financial = can(user.role, "reports.financial");
  const [metrics, weeks, sources, comps, locs] = await Promise.all([
    computeReport(f, s.attribution.fittingWindowDays),
    revenueByWeek(f),
    bySource(f),
    db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.startsAt)).limit(40),
    db.select().from(locations),
  ]);
  const shown = metrics.filter((m) => financial || m.format !== "pence");
  const fmt = (m: (typeof metrics)[number]) =>
    m.value === null ? "—" : m.format === "pence" ? formatPence(Math.round(m.value)) : m.format === "percent" ? `${m.value}%` : m.format === "decimal" ? m.value.toFixed(2) : m.value.toLocaleString("en-GB");
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const maxEntries = Math.max(1, ...weeks.map((w) => Number(w.entries)));
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Reports" description="Verified figures come from recorded transactions; estimates are labelled. Revenue is gross takings, not profit." actions={<LinkButton variant="secondary" href={`/admin/export/report?${qs}`}>Export CSV</LinkButton>} />
      <form className="mb-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Input type="date" name="from" defaultValue={DateTime.fromJSDate(f.from, { zone: DEFAULT_TZ }).toISODate()!} aria-label="From" />
        <Input type="date" name="to" defaultValue={DateTime.fromJSDate(f.to, { zone: DEFAULT_TZ }).toISODate()!} aria-label="To" />
        <Select name="competition" defaultValue={sp.competition ?? ""} aria-label="Competition"><option value="">All competitions</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="location" defaultValue={sp.location ?? ""} aria-label="Location"><option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
        <Select name="type" defaultValue={sp.type ?? ""} aria-label="Customer type"><option value="">All customers</option><option value="new">New</option><option value="returning">Returning</option></Select>
        <Input name="source" placeholder="Source (e.g. facebook)" defaultValue={sp.source ?? ""} aria-label="Source" />
        <button className="h-11 rounded-full bg-pine px-4 text-sm font-semibold text-white">Apply</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((m) => (
          <Card key={m.key} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{m.label}</div>
              {m.basis !== "verified" && <Badge tone={m.basis === "estimate" ? "warn" : "neutral"}>{m.basis}</Badge>}
            </div>
            <div className="mt-2 font-display text-3xl font-bold tabular">{fmt(m)}</div>
            {m.note && <div className="mt-1 text-xs text-muted">{m.note}</div>}
          </Card>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Entries by week" />
          <div className="space-y-2 p-5">
            {weeks.length === 0 && <p className="text-sm text-muted">No data in range.</p>}
            {weeks.map((w) => (
              <div key={w.week} className="grid grid-cols-[90px_1fr_80px] items-center gap-3 text-sm">
                <span className="text-muted">w/c {DateTime.fromISO(w.week).toFormat("d LLL")}</span>
                <span className="h-3 rounded-full bg-green-50"><span className="block h-3 rounded-full bg-green" style={{ width: `${(Number(w.entries) / maxEntries) * 100}%` }} /></span>
                <span className="text-right tabular">{w.entries}{financial ? ` · ${formatPence(Number(w.gross), { compact: true })}` : ""}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Acquisition source" description="First-touch source recorded on the customer (UTM, QR code or walk-in)." />
          <Table>
            <thead><tr><Th>Source</Th><Th>Customers</Th><Th>Entries</Th></tr></thead>
            <tbody>{sources.map((r) => <tr key={r.source}><Td>{r.source}</Td><Td>{r.customers}</Td><Td>{r.entries}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
