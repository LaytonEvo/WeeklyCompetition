import { and, desc, eq, ilike } from "drizzle-orm";
import { Card, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string }> }) {
  await requireStaffPage("audit.view");
  const sp = await searchParams;
  const conds = [sp.action ? ilike(auditLogs.action, `%${sp.action.replace(/[%_]/g, "")}%`) : undefined, sp.entity && /^[0-9a-f-]{36}$/i.test(sp.entity) ? eq(auditLogs.entityId, sp.entity) : undefined].filter(Boolean);
  const rows = await db.select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.createdAt)).limit(300);
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Audit log" description="Append-only record of score, prize, payment, consent, rule and settings changes." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="action" defaultValue={sp.action} placeholder="Action contains… (e.g. shot.correct)" className="max-w-xs" aria-label="Action" />
        <Input name="entity" defaultValue={sp.entity} placeholder="Entity ID" className="max-w-xs" aria-label="Entity id" />
        <button className="rounded-full bg-pine px-4 text-sm font-semibold text-white">Filter</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-sm">{formatLocal(r.createdAt, "d LLL HH:mm:ss")}</Td>
                <Td className="text-sm">{r.actorLabel}</Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td className="font-mono text-xs">{r.entityType}<div className="text-muted">{r.entityId?.slice(0, 8)}</div></Td>
                <Td className="max-w-md text-xs">
                  {r.reason && <div className="mb-1"><strong>Reason:</strong> {r.reason}</div>}
                  {Boolean(r.before || r.after) && (
                    <details><summary className="cursor-pointer text-green">changes</summary><pre className="mt-1 max-h-60 overflow-auto rounded bg-cream p-2 text-[11px]">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre></details>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
