import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cloneAction, lifecycleAction, updateCompetitionAction } from "@/app/admin/actions/competitions";
import { CompetitionFields } from "@/components/admin/competition-form";
import { STATUS_TONE } from "@/components/admin/status";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardHeader, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { competitionRuleVersions, competitions, rounds } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { maxJackpotExposure } from "@/lib/scoring/jackpot";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { formOptions } from "@/server/admin-data";
import { getPrizes, publishBlockers, TRANSITIONS } from "@/server/competitions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competition" };

export default async function CompetitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("competition.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c) notFound();
  const [prizes, opts, blockers, versions, [{ entries }]] = await Promise.all([
    getPrizes(id),
    formOptions(),
    ["draft", "pending_approval"].includes(c.status) ? publishBlockers(c) : Promise.resolve([]),
    db.select().from(competitionRuleVersions).where(eq(competitionRuleVersions.competitionId, id)).orderBy(desc(competitionRuleVersions.version)),
    db.select({ entries: sql<number>`count(*)::int` }).from(rounds).where(and(eq(rounds.competitionId, id), sql`${rounds.status} <> 'cancelled'`)),
  ]);
  const manage = can(user.role, "competition.manage");
  const editable = manage && !["finalised", "archived", "cancelled"].includes(c.status);
  const locked = ["open", "closed", "awaiting_verification"].includes(c.status) || entries > 0;
  const published = c.status !== "draft" && c.status !== "pending_approval";
  const next = TRANSITIONS[c.status];
  const exposure = maxJackpotExposure(c);


  return (
    <div className="mx-auto max-w-5xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        eyebrow={<Link href="/admin/competitions">Competitions</Link>}
        title={c.name}
        description={`${formatLocal(c.startsAt, "ccc d LLL HH:mm")} – ${formatLocal(c.endsAt, "ccc d LLL HH:mm")} · ${entries} entr${entries === 1 ? "y" : "ies"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[c.status]} className="px-3 py-1 text-sm">{c.status.replaceAll("_", " ")}</Badge>
            {published && <LinkButton href={`/leaderboard/${c.slug}`} variant="secondary" size="sm" target="_blank">Public page</LinkButton>}
            {["closed", "awaiting_verification", "finalised", "archived"].includes(c.status) && <LinkButton href={`/admin/competitions/${c.id}/results`} size="sm">Results</LinkButton>}
          </div>
        }
      />

      {manage && (
        <Card className="mb-6">
          <CardHeader title="Lifecycle" description="Draft → approval → scheduled (published) → open → closed → verified → finalised. Opening and closing happen automatically at the configured times." />
          <div className="space-y-4 p-5">
            {blockers.length > 0 && (
              <Alert tone="warn" title="Cannot be published yet">
                <ul className="mt-1 list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </Alert>
            )}
            {c.jackpotEnabled && <p className="text-sm text-muted">Maximum possible jackpot payout under this configuration: <strong className="text-ink">{Number.isFinite(exposure) ? formatPence(exposure) : "unbounded"}</strong>.</p>}
            <div className="flex flex-wrap items-start gap-3">
              {next.includes("pending_approval") && <Op id={c.id} op="submit" label="Submit for approval" />}
              {next.includes("scheduled") && <Op id={c.id} op="approve" label="Approve & publish" variant="primary" confirm="Publish this competition? Its rules become public." />}
              {next.includes("draft") && c.status !== "pending_approval" && <Op id={c.id} op="draft" label="Unpublish (back to draft)" needsReason />}
              {next.includes("draft") && c.status === "pending_approval" && <Op id={c.id} op="draft" label="Return to draft" needsReason />}
              {next.includes("open") && <Op id={c.id} op="open" label="Open now" />}
              {next.includes("closed") && c.status === "open" && <Op id={c.id} op="close" label="Close now" confirm="Close entries now? No new rounds can start." />}
              {next.includes("archived") && <Op id={c.id} op="archive" label="Archive" />}
              {next.includes("cancelled") && <Op id={c.id} op="cancel" label="Cancel competition" variant="danger" needsReason confirm="Cancel this competition? Entrants will be emailed." />}
            </div>
            <ActionForm action={cloneAction} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Use as template for a new draft — weeks later" htmlFor="weeks"><Input id="weeks" name="weeks" type="number" min={0} max={52} defaultValue={1} className="w-24" /></Field>
              <SubmitButton variant="secondary">Duplicate</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}

      {editable ? (
        <ActionForm action={updateCompetitionAction}>
          <input type="hidden" name="id" value={c.id} />
          <CompetitionFields
            {...opts}
            locked={locked}
            v={{ ...c, prizes: prizes.map((p) => ({ rank: p.rank, amountPence: p.amountPence, description: p.description })) }}
            extra={
              published ? (
                <Card className="p-5">
                  <Field label="Reason for change (required for material changes — entrants will be notified)" htmlFor="changeReason"><Input id="changeReason" name="changeReason" /></Field>
                </Card>
              ) : null
            }
          />
          <div className="sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
            <SubmitButton size="lg">Save changes</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <Alert>This competition can no longer be edited.</Alert>
      )}

      {versions.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Published rule changes" description="Immutable history of material changes after publication." />
          <ul className="divide-y divide-line text-sm">
            {versions.map((v) => (
              <li key={v.id} className="px-5 py-3"><span className="font-semibold">v{v.version}</span> · {formatLocal(v.createdAt, "d LLL HH:mm")} — {v.changeSummary}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Op({ id, op, label, variant = "secondary", confirm, needsReason }: { id: string; op: string; label: string; variant?: "primary" | "secondary" | "danger" | "gold"; confirm?: string; needsReason?: boolean }) {
  return (
    <ActionForm action={lifecycleAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {needsReason && <Input name="reason" placeholder="Reason (required)" required aria-label="Reason" />}
      <SubmitButton variant={variant} confirm={confirm}>{label}</SubmitButton>
    </ActionForm>
  )
}
