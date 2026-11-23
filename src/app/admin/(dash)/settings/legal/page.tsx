import { desc, eq } from "drizzle-orm";
import { addFundingAction, recordApprovalAction, revokeApprovalAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { db } from "@/db";
import { jackpotFunding, legalApprovals, users } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatPence } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Legal & launch gate" };

export default async function LegalPage() {
  await requireStaffPage("legal.approve");
  const s = await getSettings();
  const approvals = await db.select({ a: legalApprovals, by: users.name }).from(legalApprovals).innerJoin(users, eq(users.id, legalApprovals.recordedByUserId)).orderBy(desc(legalApprovals.approvedAt));
  const funds = await db.select().from(jackpotFunding).orderBy(desc(jackpotFunding.createdAt));
  return (
    <div className="mx-auto max-w-4xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Legal & launch gate" description="Paid entry, payment collection and public cash-prize claims stay disabled until an approval for the competition's entry mode and exact terms version is recorded here." />
      <Alert tone="warn" title="This system does not decide legality" className="mb-6">
        UK paid-entry prize competitions can engage the Gambling Act 2005. Recording an approval here only records that the operator has obtained and accepted independent legal review of the final rules and promotional terms. It does not mean the competition is exempt, licensed or insured.
      </Alert>
      <Card className="mb-6">
        <CardHeader title="Recorded approvals" />
        <ul className="divide-y divide-line text-sm">
          {approvals.length === 0 && <li className="px-5 py-4 text-muted">None — paid entry is locked.</li>}
          {approvals.map(({ a, by }) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
              <div>
                <div className="flex items-center gap-2"><Badge tone={a.revokedAt ? "neutral" : "green"}>{a.revokedAt ? "revoked" : "active"}</Badge><strong>{a.scope === "paid_entry" ? "Paid entry" : "Free promotion"}</strong> · terms <span className="font-mono">{a.termsVersion}</span></div>
                <div className="mt-1 text-xs text-muted">Reviewer: {a.reviewerName}{a.reviewerOrganisation ? `, ${a.reviewerOrganisation}` : ""} · recorded by {by} {formatLocal(a.approvedAt, "d LLL yyyy")}{a.revokeReason ? ` · revoked: ${a.revokeReason}` : ""}</div>
                {a.notes && <div className="mt-1 text-xs">{a.notes}</div>}
              </div>
              {!a.revokedAt && (
                <ActionForm action={revokeApprovalAction} className="flex items-center gap-2 space-y-0">
                  <input type="hidden" name="id" value={a.id} />
                  <Input name="reason" placeholder="Reason" className="w-40" aria-label="Revoke reason" />
                  <SubmitButton size="sm" variant="danger" confirm="Revoke? Competitions using these terms will be unable to open or take payment.">Revoke</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        <ActionForm action={recordApprovalAction} className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
          <Field label="Scope" htmlFor="scope"><Select id="scope" name="scope"><option value="paid_entry">Paid-entry skill competition</option><option value="free_promotion">Free-entry promotion</option></Select></Field>
          <Field label="Terms version" htmlFor="tv" hint={`Current site terms: ${s.legalTexts.termsVersion}`}><Input id="tv" name="termsVersion" defaultValue={s.legalTexts.termsVersion} /></Field>
          <Field label="Reviewer name" htmlFor="rn"><Input id="rn" name="reviewerName" /></Field>
          <Field label="Firm / organisation" htmlFor="ro"><Input id="ro" name="reviewerOrganisation" /></Field>
          <Field label="Notes (advice reference, conditions)" htmlFor="rnotes" className="sm:col-span-2"><Textarea id="rnotes" name="notes" rows={2} /></Field>
          <Checkbox name="attest" className="sm:col-span-2" label="I confirm the final competition rules and promotional terms for this version have been reviewed by the named qualified adviser and the business accepts that advice." />
          <div><SubmitButton>Record approval</SubmitButton></div>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Jackpot funding & insurance" description="Do not assume conventional hole-in-one insurance covers simulator play. A jackpot cannot be published unless linked to a record explicitly confirmed to cover simulator hole-in-ones and its maximum payout." />
        <ul className="divide-y divide-line text-sm">
          {funds.map((f) => (
            <li key={f.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={f.simulatorCoverageConfirmed ? "green" : "danger"}>{f.simulatorCoverageConfirmed ? "simulator cover confirmed" : "simulator cover NOT confirmed"}</Badge><strong>{f.provider}</strong> · {f.kind.replaceAll("_", " ")} {f.policyReference ? `· ${f.policyReference}` : ""}</div>
              <div className="mt-1 text-xs text-muted">Limit {formatPence(f.coverageLimitPence)}{f.perEventLimitPence ? `, per event ${formatPence(f.perEventLimitPence)}` : ""} · {formatLocal(f.validFrom, "d LLL yyyy")} – {formatLocal(f.validTo, "d LLL yyyy")} · {f.coveredFormat}{f.exclusions ? ` · exclusions: ${f.exclusions}` : ""}</div>
            </li>
          ))}
        </ul>
        <ActionForm action={addFundingAction} className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
          <Field label="Type" htmlFor="fk"><Select id="fk" name="kind"><option value="insurance">Insurance policy</option><option value="allocated_funds">Ring-fenced business funds</option></Select></Field>
          <Field label="Insurer / funding arrangement" htmlFor="fp"><Input id="fp" name="provider" /></Field>
          <Field label="Policy reference" htmlFor="fr"><Input id="fr" name="policyReference" /></Field>
          <Field label="Coverage limit (£)" htmlFor="fl"><Input id="fl" name="coverageLimit" /></Field>
          <Field label="Per-event limit (£, optional)" htmlFor="fe"><Input id="fe" name="perEventLimit" /></Field>
          <Field label="Covered competition format" htmlFor="ff"><Input id="ff" name="coveredFormat" placeholder="e.g. Simulator, single par 3, 1 shot per attempt" /></Field>
          <Field label="Valid from" htmlFor="vf"><Input id="vf" name="validFrom" type="date" /></Field>
          <Field label="Valid to" htmlFor="vt"><Input id="vt" name="validTo" type="date" /></Field>
          <Field label="Exclusions" htmlFor="fx" className="sm:col-span-2"><Textarea id="fx" name="exclusions" rows={2} /></Field>
          <Field label="Evidence requirements" htmlFor="fv" className="sm:col-span-2"><Textarea id="fv" name="evidenceRequirements" rows={2} /></Field>
          <Checkbox name="simulatorCoverageConfirmed" className="sm:col-span-2" label="I have confirmed in writing that this cover/funding applies to hole-in-ones on a golf simulator in this format." />
          <div><SubmitButton>Add funding record</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
