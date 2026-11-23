import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Badge, Card, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { competitions, customers, payments, rounds } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entries" };
const STATUSES = ["booked", "checked_in", "in_progress", "paused", "completed", "disqualified", "cancelled", "voided"] as const;

export default async function EntriesPage({ searchParams }: { searchParams: Promise<{ c?: string; status?: string }> }) {
  await requireStaffPage("booking.view");
  const sp = await searchParams;
  const comps = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.startsAt)).limit(30);
  const compId = sp.c ?? comps[0]?.id;
  const conds = [compId ? eq(rounds.competitionId, compId) : undefined, STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? eq(rounds.status, sp.status as (typeof STATUSES)[number]) : undefined].filter(Boolean);
  const rows = await db
    .select({ r: rounds, c: customers, p: payments })
    .from(rounds)
    .innerJoin(customers, eq(customers.id, rounds.customerId))
    .leftJoin(payments, eq(payments.id, rounds.paymentId))
    .where(and(...conds))
    .orderBy(desc(rounds.createdAt))
    .limit(500);
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Entries" description="Each purchased or authorised entry is one round." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Select name="c" defaultValue={compId} className="max-w-xs" aria-label="Competition">{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="max-w-48" aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</Select>
        <button className="rounded-full bg-pine px-4 text-sm font-semibold text-white">Filter</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>Created</Th><Th>Player</Th><Th>Status</Th><Th>Authorisation</Th><Th>Started</Th><Th>Completed</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={6} className="py-10 text-center text-muted">No entries.</Td></tr>}
            {rows.map(({ r, c, p }) => (
              <tr key={r.id}>
                <Td className="text-sm">{formatLocal(r.createdAt, "d LLL HH:mm")}</Td>
                <Td><Link className="font-medium hover:text-pine" href={`/admin/customers/${c.id}`}>{c.firstName} {c.lastName}</Link></Td>
                <Td><Badge tone={r.status === "completed" ? "green" : ["voided", "cancelled", "disqualified"].includes(r.status) ? "danger" : "blue"}>{r.status.replaceAll("_", " ")}</Badge>{r.statusReason && <div className="mt-1 max-w-56 text-xs text-muted">{r.statusReason}</div>}{r.restartOfRoundId && <div className="text-xs text-muted">replacement round</div>}</Td>
                <Td className="text-sm">{p ? `${p.method.replaceAll("_", " ")} · ${p.status.replaceAll("_", " ")}` : "—"}</Td>
                <Td className="text-sm">{formatLocal(r.startedAt, "d LLL HH:mm")}</Td>
                <Td className="text-sm">{formatLocal(r.completedAt, "d LLL HH:mm")}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
