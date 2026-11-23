import Link from "next/link";
import { Badge, Card, CardHeader, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { competitionTemplates } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { listCompetitions } from "@/server/competitions";
import { STATUS_TONE } from "@/components/admin/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competitions" };


export default async function CompetitionsPage() {
  const user = await requireStaffPage("competition.view");
  const [rows, templates] = await Promise.all([listCompetitions(), db.select().from(competitionTemplates)]);
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Competitions" description="Create, approve, run and finalise competitions." actions={can(user.role, "competition.manage") && <LinkButton href="/admin/competitions/new">New competition</LinkButton>} />
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Runs</Th><Th>Entry</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-cream/60">
                <Td><Link href={`/admin/competitions/${c.id}`} className="font-semibold hover:text-pine">{c.name}</Link><div className="text-xs text-muted">{c.holeName}</div></Td>
                <Td className="whitespace-nowrap text-sm">{formatLocal(c.startsAt, "d LLL HH:mm")} – {formatLocal(c.endsAt, "d LLL HH:mm")}</Td>
                <Td>{c.entryMode === "free" ? "Free" : formatPence(c.entryFeePence)}</Td>
                <Td><Badge tone={STATUS_TONE[c.status]}>{c.status.replaceAll("_", " ")}</Badge></Td>
                <Td className="text-right">
                  {["closed", "awaiting_verification", "finalised", "archived"].includes(c.status) && <Link href={`/admin/competitions/${c.id}/results`} className="text-sm font-semibold text-green">Results</Link>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Weekly templates" description="Drafts for the coming weeks are created automatically from templates with auto-create on. Each still needs approval before it is published." />
        <ul className="divide-y divide-line">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-5 py-3.5">
              <div><div className="font-medium">{t.name}</div><div className="text-xs text-muted">{t.config.entryMode === "free" ? "Free" : formatPence(t.config.entryFeePence)} · {t.config.shotsPerRound} shots · next #{t.nextSequence} · auto-create {t.autoCreateWeekly ? "on" : "off"}</div></div>
              {can(user.role, "competition.manage") && <LinkButton href={`/admin/competitions/template/${t.id}`} variant="secondary" size="sm">Edit template</LinkButton>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
