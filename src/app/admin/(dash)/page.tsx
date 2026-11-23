import { ArrowRight, Target } from "lucide-react";
import Link from "next/link";
import { Alert, Badge, Card, CardHeader, LinkButton, PageHeader, Stat } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { dashboardKpis } from "@/server/dashboard";
import { isLaunchApproved } from "@/server/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function Overview() {
  const user = await requireStaffPage("dashboard.view");
  const k = await dashboardKpis();
  const approved = k.active ? await isLaunchApproved(k.active) : false;
  const financial = can(user.role, "reports.financial");
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        eyebrow="Overview"
        title={k.active?.name ?? "No active competition"}
        description={k.active ? `${k.active.status.replaceAll("_", " ")} · closes ${formatLocal(k.active.endsAt, "cccc d LLL, HH:mm")}` : "Create and publish a competition to get started."}
        actions={can(user.role, "round.operate") && <LinkButton href="/admin/live" size="lg"><Target className="size-5" /> Open live console</LinkButton>}
      />
      {k.active && !approved && (
        <Alert tone="warn" title="Launch gate closed" className="mb-6">
          No current legal approval is recorded for this competition&apos;s entry mode and terms version. Paid entry, payment collection and public prize claims stay disabled. A Super Admin records approval in Settings › Legal & launch gate.
        </Alert>
      )}
      {k.pendingHio > 0 && can(user.role, "hio.review") && (
        <Alert tone="gold" title={`${k.pendingHio} hole-in-one claim${k.pendingHio > 1 ? "s" : ""} awaiting review`} className="mb-6">
          <Link href="/admin/hole-in-one" className="font-semibold underline">Review claims</Link> — no jackpot can be paid until approved.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Entries this week" value={k.entriesWeek} hint={`${k.uniqueWeek} unique players`} />
        {financial && <Stat label="Revenue this week" value={formatPence(k.revenueWeek)} hint="Gross after refunds — not profit" />}
        <Stat label="Current leader" value={k.leader ? formatMm(k.leader.bestScore) : "—"} hint={k.leader?.displayName ?? "No scores yet"} tone="green" />
        <Stat label="Shots recorded" value={k.shotsWeek} hint="This week" />
        <Stat label="Simulator bookings today" value={k.bookingsToday} />
        <Stat label="Rounds in progress" value={k.outstanding} hint="Awaiting completion/verification" />
        <Stat label="New customers" value={k.newCustomers} hint="This week" />
        <Stat label="Fitting enquiries" value={k.fittingEnq} hint="Flagged this week" tone="gold" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming competitions" action={can(user.role, "competition.manage") && <LinkButton href="/admin/competitions/new" size="sm">New</LinkButton>} />
          <ul className="divide-y divide-line">
            {k.upcoming.length === 0 && <li className="px-5 py-6 text-sm text-muted">Nothing scheduled. Drafts are created automatically from the weekly template.</li>}
            {k.upcoming.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/competitions/${c.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-cream">
                  <span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{formatLocal(c.startsAt, "ccc d LLL HH:mm")} – {formatLocal(c.endsAt, "ccc d LLL HH:mm")}</span></span>
                  <Badge tone={c.status === "scheduled" ? "green" : c.status === "pending_approval" ? "warn" : "neutral"}>{c.status.replaceAll("_", " ")}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Results to finalise" />
          <ul className="divide-y divide-line">
            {k.needsResults.length === 0 && <li className="px-5 py-6 text-sm text-muted">No closed competitions awaiting results.</li>}
            {k.needsResults.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/competitions/${c.id}/results`} className="flex items-center justify-between px-5 py-3.5 hover:bg-cream">
                  <span className="font-medium">{c.name}</span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-green">Review <ArrowRight className="size-4" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
