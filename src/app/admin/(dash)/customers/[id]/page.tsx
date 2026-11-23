import Link from "next/link";
import { notFound } from "next/navigation";
import { addNote, anonymiseAction, mergeAction, recordFittingEnquiry, updateCustomer, withdrawConsent } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardHeader, Checkbox, Field, Input, LinkButton, PageHeader, Select, Stat, Textarea } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { customerProfile } from "@/server/customer-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("customer.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await customerProfile(id);
  if (!p) notFound();
  const { c, stats } = p;
  const edit = can(user.role, "customer.edit");
  return (
    <div className="mx-auto max-w-6xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        eyebrow={<Link href="/admin/customers">Customers</Link>}
        title={`${c.firstName} ${c.lastName}`}
        description={`Customer since ${formatLocal(c.createdAt, "d LLL yyyy")} · source ${c.utmSource ?? c.acquisitionSource ?? "unknown"}${c.utmCampaign ? ` / ${c.utmCampaign}` : ""}`}
        actions={can(user.role, "customer.export") && <LinkButton variant="secondary" href={`/admin/export/customer/${c.id}`}>Export data (JSON)</LinkButton>}
      />
      {c.mergedIntoId && <Alert tone="warn" className="mb-4">This record was merged into <Link className="underline" href={`/admin/customers/${c.mergedIntoId}`}>another customer</Link>.</Alert>}
      {c.anonymisedAt && <Alert className="mb-4">Personal data erased on {formatLocal(c.anonymisedAt, "d LLL yyyy")}. Results retained anonymously.</Alert>}
      {p.possibleDuplicates.length > 0 && <Alert tone="gold" className="mb-4" title="Possible duplicate">Another record shares this mobile number: {p.possibleDuplicates.map((d) => <Link key={d.id} href={`/admin/customers/${d.id}`} className="mr-2 underline">{d.firstName} {d.lastName}</Link>)}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Visits" value={stats.visits} />
        <Stat label="Rounds" value={stats.rounds} />
        <Stat label="Shots" value={stats.shots} />
        <Stat label="Personal best" value={stats.personalBest !== null ? formatMm(stats.personalBest) : "—"} tone="green" />
        <Stat label="Weekly wins" value={stats.weeklyWins} tone="gold" />
        <Stat label="Hole-in-ones" value={stats.holeInOnes} tone="gold" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Competition history" />
            <ul className="divide-y divide-line text-sm">
              {p.rounds.length === 0 && <li className="px-5 py-4 text-muted">No rounds.</li>}
              {p.rounds.map(({ r, comp }) => {
                const rs = p.shots.filter((s) => s.roundId === r.id).sort((a, b) => a.shotNumber - b.shotNumber);
                return (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex justify-between"><span className="font-medium">{comp.name}</span><Badge tone={r.status === "completed" ? "green" : "neutral"}>{r.status.replaceAll("_", " ")}</Badge></div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
                      <span className="mr-2">{formatLocal(r.startedAt ?? r.createdAt, "d LLL HH:mm")}</span>
                      {rs.map((s) => <span key={s.id} className={`rounded px-1.5 py-0.5 tabular ${s.valid && s.onGreen ? "bg-green-50 text-pine" : "bg-zinc-100 line-through"}`}>{s.isHoleInOne ? `ACE (${s.hioStatus})` : s.distanceMm !== null ? formatMm(s.distanceMm) : "—"}</span>)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Prizes" />
            <ul className="divide-y divide-line text-sm">
              {p.awards.length === 0 && <li className="px-5 py-4 text-muted">None.</li>}
              {p.awards.map(({ a, comp }) => <li key={a.id} className="flex justify-between px-5 py-3"><span>{comp.name} · {a.kind === "jackpot" ? "Jackpot" : `#${a.rank}`}</span><span>{formatPence(a.prizeAmountPence)} <Badge tone="gold">{a.status.replaceAll("_", " ")}</Badge></span></li>)}
            </ul>
          </Card>
          {can(user.role, "payment.view") && (
            <Card>
              <CardHeader title="Payments" />
              <ul className="divide-y divide-line text-sm">
                {p.payments.length === 0 && <li className="px-5 py-4 text-muted">None.</li>}
                {p.payments.map((x) => <li key={x.id} className="flex justify-between px-5 py-3"><span>{formatLocal(x.createdAt, "d LLL yyyy")} · {x.method.replaceAll("_", " ")} · {x.roundsQty} round(s)</span><span>{formatPence(x.amountPence)} · {x.status.replaceAll("_", " ")}</span></li>)}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Fitting enquiries" description="Used to measure fittings generated by the competition." />
            <ul className="divide-y divide-line text-sm">
              {p.enquiries.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <ActionForm action={recordFittingEnquiry} className="flex flex-wrap items-end gap-2 space-y-0">
                    <input type="hidden" name="customerId" value={c.id} />
                    <input type="hidden" name="enquiryId" value={e.id} />
                    <span className="w-full text-xs text-muted">{formatLocal(e.createdAt, "d LLL yyyy")} · {e.source}</span>
                    <Select name="status" defaultValue={e.status} className="w-36" aria-label="Status"><option value="new">New</option><option value="contacted">Contacted</option><option value="booked">Fitting booked</option><option value="completed">Completed</option><option value="lost">Lost</option></Select>
                    <Input name="saleValue" placeholder="Sale £" defaultValue={e.saleValuePence ? (e.saleValuePence / 100).toFixed(2) : ""} className="w-28" aria-label="Sale value" />
                    <Input name="notes" placeholder="Notes" defaultValue={e.notes ?? ""} className="w-48" aria-label="Notes" />
                    <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={recordFittingEnquiry} className="flex gap-2 border-t border-line p-5">
              <input type="hidden" name="customerId" value={c.id} />
              <input type="hidden" name="source" value="staff" />
              <SubmitButton size="sm" variant="secondary">Log new fitting enquiry</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Profile" />
            {edit && !c.anonymisedAt ? (
              <ActionForm action={updateCustomer} className="grid gap-3 p-5 sm:grid-cols-2">
                <input type="hidden" name="id" value={c.id} />
                <Field label="First name" htmlFor="fn"><Input id="fn" name="firstName" defaultValue={c.firstName} /></Field>
                <Field label="Last name" htmlFor="ln"><Input id="ln" name="lastName" defaultValue={c.lastName} /></Field>
                <Field label="Email" htmlFor="em" className="sm:col-span-2"><Input id="em" name="email" defaultValue={c.email} /></Field>
                <Field label="Mobile" htmlFor="mo"><Input id="mo" name="mobile" defaultValue={c.mobile.replace(/^\+44/, "0")} /></Field>
                <Field label="Handicap" htmlFor="hc"><Input id="hc" name="handicap" defaultValue={c.handicap ?? ""} /></Field>
                <Field label="Home club" htmlFor="cl" className="sm:col-span-2"><Input id="cl" name="homeClub" defaultValue={c.homeClub ?? ""} /></Field>
                <Field label="Leaderboard name" htmlFor="dn" className="sm:col-span-2"><Select id="dn" name="displayNameStyle" defaultValue={c.displayNameStyle}><option value="first_initial">First name + initial</option><option value="initials">Initials</option><option value="anonymous">Anonymous</option><option value="full">Full name (needs publication consent)</option></Select></Field>
                <Checkbox name="fittingInterest" defaultChecked={c.fittingInterest} label="Interested in a fitting" className="sm:col-span-2" />
                <div><SubmitButton>Save</SubmitButton></div>
              </ActionForm>
            ) : (
              <dl className="space-y-1 p-5 text-sm"><div>{c.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}</div><div>{c.mobile ? `•••• ${c.mobile.slice(-4)}` : ""}</div><div>Handicap {c.handicap ?? "—"} · {c.homeClub ?? "—"}</div></dl>
            )}
          </Card>
          <Card>
            <CardHeader title="Consents" description="Append-only log. Marketing is separate from participation." />
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              <Badge tone={c.marketingEmailConsent ? "green" : "neutral"}>Marketing email: {c.marketingEmailConsent ? "yes" : "no"}</Badge>
              <Badge tone={c.publicationConsent ? "green" : "neutral"}>Publication: {c.publicationConsent ? "yes" : "no"}</Badge>
            </div>
            <div className="flex gap-2 px-5 pt-3">
              {c.marketingEmailConsent && <ActionForm action={withdrawConsent}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="type" value="marketing_email" /><SubmitButton size="sm" variant="secondary">Withdraw marketing</SubmitButton></ActionForm>}
              {c.publicationConsent && <ActionForm action={withdrawConsent}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="type" value="publication" /><SubmitButton size="sm" variant="secondary">Withdraw publication</SubmitButton></ActionForm>}
            </div>
            <ul className="mt-3 max-h-64 divide-y divide-line overflow-y-auto border-t border-line text-xs">
              {p.consents.map((x) => <li key={x.id} className="flex justify-between px-5 py-2"><span>{x.type.replaceAll("_", " ")} — <strong>{x.granted ? "granted" : "withdrawn"}</strong> · {x.source}</span><span className="text-muted">{x.noticeVersion} · {formatLocal(x.createdAt, "d LLL yy HH:mm")}</span></li>)}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Staff notes" description="Visible to the customer in a data export." />
            <ul className="divide-y divide-line text-sm">{p.notes.map(({ n, author }) => <li key={n.id} className="px-5 py-3"><p>{n.body}</p><p className="mt-1 text-xs text-muted">{author} · {formatLocal(n.createdAt, "d LLL yy HH:mm")}</p></li>)}</ul>
            {can(user.role, "customer.notes") && (
              <ActionForm action={addNote} resetOnSuccess className="border-t border-line p-5">
                <input type="hidden" name="id" value={c.id} />
                <Textarea name="body" rows={2} placeholder="Add a factual note" aria-label="Note" />
                <SubmitButton size="sm">Add note</SubmitButton>
              </ActionForm>
            )}
          </Card>
          {can(user.role, "customer.merge") && !c.mergedIntoId && (
            <Card>
              <CardHeader title="Merge duplicate" description="Moves all history from another record into this one. The other record is kept as a merged tombstone." />
              <ActionForm action={mergeAction} className="space-y-3 p-5">
                <input type="hidden" name="targetId" value={c.id} />
                <Input name="sourceId" placeholder="ID of the duplicate record to merge in" aria-label="Duplicate customer id" defaultValue={p.possibleDuplicates[0]?.id ?? ""} />
                <Input name="reason" placeholder="Reason" aria-label="Reason" />
                <SubmitButton variant="secondary" confirm="Merge the duplicate into this customer?">Merge into this customer</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {can(user.role, "customer.erase") && !c.anonymisedAt && (
            <Card>
              <CardHeader title="Erase personal data" description="For erasure requests. Contact details are removed; results stay anonymised; financial records are kept." />
              <ActionForm action={anonymiseAction} className="space-y-3 p-5">
                <input type="hidden" name="id" value={c.id} />
                <Input name="reason" placeholder="Reason / request reference" aria-label="Reason" />
                <Input name="confirm" placeholder="Type ERASE to confirm" aria-label="Confirm" />
                <SubmitButton variant="danger">Erase personal data</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <p className="text-xs text-muted">ID: <span className="font-mono">{c.id}</span></p>
        </div>
      </div>
    </div>
  );
}
