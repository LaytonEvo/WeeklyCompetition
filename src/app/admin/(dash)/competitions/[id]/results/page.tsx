import { inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { finaliseAction } from "@/app/admin/actions/competitions";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { provisionalResults } from "@/server/results";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("competition.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await provisionalResults(id).catch(() => null);
  if (!r) notFound();
  const { competition: c, standings, allocation, outstanding, jackpots, prizes } = r;
  const ids = [...new Set([...standings.slice(0, 30).map((s) => s.customerId), ...jackpots.map((j) => j.customerId)])];
  const people = ids.length ? await db.select().from(customers).where(inArray(customers.id, ids)) : [];
  const fullName = (cid: string) => {
    const p = people.find((x) => x.id === cid);
    return p ? `${p.firstName} ${p.lastName}` : cid;
  };
  const alloc = new Map(allocation.allocations.map((a) => [a.customerId, a]));
  const finalised = ["finalised", "archived"].includes(c.status);
  const canFinalise = can(user.role, "competition.finalise") && ["closed", "awaiting_verification"].includes(c.status);
  const blocked = outstanding.blocking > 0;

  return (
    <div className="mx-auto max-w-5xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader eyebrow={<Link href={`/admin/competitions/${c.id}`}>{c.name}</Link>} title={finalised ? "Official results" : "Provisional results"} description={`Tie procedure: ${c.tiePolicyText || c.tiePolicy}`} />

      {!finalised && ["open", "scheduled"].includes(c.status) && <Alert tone="neutral" className="mb-6">The competition is still {c.status}. Results can be finalised once it has closed.</Alert>}
      {blocked && !finalised && (
        <Alert tone="warn" title="Outstanding verification" className="mb-6">
          {outstanding.openRounds.length} round(s) not yet completed and {outstanding.pendingHio.length} hole-in-one claim(s) pending.{" "}
          <Link href="/admin/live" className="underline">Live rounds</Link> · <Link href="/admin/hole-in-one" className="underline">Hole-in-one claims</Link>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader title="Standings" description={`${standings.length} players. Full names are shown to staff only.`} />
        <Table>
          <thead><tr><Th>Pos</Th><Th>Player</Th><Th>Best</Th><Th>Rounds</Th><Th>Set</Th><Th>Prize</Th></tr></thead>
          <tbody>
            {standings.slice(0, 30).map((s) => {
              const a = alloc.get(s.customerId);
              return (
                <tr key={s.customerId}>
                  <Td className="font-display text-lg font-bold">{s.tiedWith > 1 ? `T${s.rank}` : s.rank}</Td>
                  <Td><Link href={`/admin/customers/${s.customerId}`} className="font-medium hover:text-pine">{fullName(s.customerId)}</Link> <span className="text-xs text-muted">({s.displayName})</span>{s.needsPlayoff && <Badge tone="warn" className="ml-2">playoff</Badge>}</Td>
                  <Td className="font-display text-lg font-bold text-pine tabular">{s.holeInOne ? "ACE" : formatMm(s.bestScore, 3)}</Td>
                  <Td>{s.roundsCompleted}</Td>
                  <Td className="text-sm text-muted">{formatLocal(s.bestShotAt, "ccc d LLL HH:mm")}</Td>
                  <Td>{a ? <span className="font-semibold">{formatPence(a.amountPence)}{a.splitWays > 1 ? ` (${a.splitWays}-way)` : ""}</span> : "—"}</Td>
                </tr>
              );
            })}
            {standings.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-muted">No verified scores.</Td></tr>}
          </tbody>
        </Table>
        {allocation.allocations.some((a) => a.remainderPence) && <p className="px-5 py-3 text-sm text-warn">An equal split leaves {allocation.allocations[0].remainderPence}p undistributed. Decide how to handle it and note it below.</p>}
        {prizes.length === 0 && <p className="px-5 py-3 text-sm text-muted">No weekly prizes are defined for this competition.</p>}
      </Card>

      {jackpots.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Hole-in-one jackpot awards" />
          <ul className="divide-y divide-line text-sm">
            {jackpots.map((j) => <li key={j.id} className="flex justify-between px-5 py-3"><span>{fullName(j.customerId)}</span><span>{formatPence(j.prizeAmountPence)} · <Badge tone="gold">{j.status.replaceAll("_", " ")}</Badge></span></li>)}
          </ul>
        </Card>
      )}

      {canFinalise && (
        <Card>
          <CardHeader title="Finalise official results" description="Records winners, starts the claim period and emails official winner notifications. This cannot be undone." />
          <ActionForm action={finaliseAction} className="p-5">
            <input type="hidden" name="id" value={c.id} />
            {allocation.unresolvedPlayoffs.map((g) => (
              <div key={g.rank} className="rounded-2xl bg-warn-50 p-4 ring-1 ring-warn/20">
                <div className="mb-2 text-sm font-semibold">Playoff result for tied position {g.rank}</div>
                {g.customerIds.map((_, i) => (
                  <Field key={i} label={`Finishing position ${g.rank + i}`} htmlFor={`po${g.rank}${i}`} className="mb-2">
                    <Select id={`po${g.rank}${i}`} name={`playoff_${g.rank}_${i}`} defaultValue="" required>
                      <option value="" disabled>Choose player…</option>
                      {g.customerIds.map((cid) => <option key={cid} value={cid}>{fullName(cid)}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
            ))}
            <Field label="Notes (optional, kept with the awards)" htmlFor="notes"><Input id="notes" name="notes" /></Field>
            <SubmitButton size="lg" confirm="Finalise these results and notify winners?">{blocked ? "Resolve outstanding items first" : "Finalise results"}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {finalised && <Alert tone="green">Finalised {formatLocal(c.finalisedAt, "d LLL yyyy HH:mm")}. Track claims and payments in <Link href="/admin/winners" className="underline">Winners & prizes</Link>.</Alert>}
    </div>
  );
}
