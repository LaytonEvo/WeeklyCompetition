import { inArray } from "drizzle-orm";
import Link from "next/link";
import { reviewClaimAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, EmptyState, PageHeader, Select, Textarea } from "@/components/ui";
import { db } from "@/db";
import { shotEvidence, users } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { maxJackpotExposure } from "@/lib/scoring/jackpot";
import { formatPence } from "@/lib/money";
import { signEvidenceUrl } from "@/lib/storage";
import { formatLocal } from "@/lib/time";
import { listClaims } from "@/server/hio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hole-in-one claims" };

export default async function HioPage() {
  const me = await requireStaffPage("hio.review");
  const claims = await listClaims();
  const roundIds = claims.map((c) => c.shot.roundId);
  const ev = roundIds.length ? await db.select().from(shotEvidence).where(inArray(shotEvidence.roundId, roundIds)) : [];
  const staff = await db.select({ id: users.id, name: users.name }).from(users);
  const name = (id: string | null) => staff.find((s) => s.id === id)?.name ?? "—";
  const pending = claims.filter((c) => c.claim.status === "pending_review");
  const decided = claims.filter((c) => c.claim.status !== "pending_review");
  return (
    <div className="mx-auto max-w-5xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Hole-in-one claims" description="Every claim needs simulator evidence and approval by a manager who did not witness it. Jackpot eligibility and liability caps are checked automatically at approval." />
      {pending.length === 0 && <EmptyState title="No claims awaiting review" />}
      <div className="space-y-6">
        {pending.map(({ claim, customer, competition, shot }) => {
          const files = ev.filter((e) => e.shotId === shot.id || (e.roundId === shot.roundId && !e.shotId));
          const isWitness = claim.witnessUserId === me.id;
          return (
            <Card key={claim.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-gold-50/60 px-6 py-4">
                <div>
                  <Badge tone="gold">Pending review</Badge>
                  <h2 className="mt-1 text-lg font-semibold"><Link href={`/admin/customers/${customer.id}`} className="hover:text-pine">{customer.firstName} {customer.lastName}</Link></h2>
                  <p className="text-sm text-muted">{competition.name} · shot {shot.shotNumber} · {formatLocal(shot.recordedAt, "ccc d LLL HH:mm")}</p>
                </div>
                <div className="text-right text-sm">
                  <div>Jackpot: <strong>{competition.jackpotEnabled ? formatPence(competition.jackpotAmountPence) : "not enabled"}</strong></div>
                  {competition.jackpotEnabled && <div className="text-muted">Max payout {Number.isFinite(maxJackpotExposure(competition)) ? formatPence(maxJackpotExposure(competition)) : "unbounded"} · max {competition.jackpotMaxWinners ?? "∞"} winner(s)</div>}
                </div>
              </div>
              <div className="grid gap-6 p-6 md:grid-cols-2">
                <div className="space-y-3 text-sm">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-muted">Witness</div>{name(claim.witnessUserId)}{claim.secondWitnessName ? ` + ${claim.secondWitnessName}` : ""}</div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-muted">Statement</div><p className="whitespace-pre-line">{claim.staffStatement}</p></div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Evidence ({files.length})</div>
                    {files.length === 0 ? <Alert tone="warn">No evidence uploaded yet. Upload from the live console (camera icon on the shot).</Alert> : (
                      <div className="grid grid-cols-2 gap-2">
                        {files.map((f) => (
                          <a key={f.id} href={signEvidenceUrl(f.storageKey)} target="_blank" className="block overflow-hidden rounded-xl ring-1 ring-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={signEvidenceUrl(f.storageKey)} alt="Evidence" className="aspect-video w-full object-cover" />
                            <div className="px-2 py-1 font-mono text-[10px] text-muted">sha256 {f.sha256.slice(0, 12)}…</div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  {isWitness ? (
                    <Alert tone="neutral">You witnessed this shot, so another manager must review it.</Alert>
                  ) : (
                    <ActionForm action={reviewClaimAction}>
                      <input type="hidden" name="id" value={claim.id} />
                      <Select name="decision" defaultValue="approve" aria-label="Decision"><option value="approve">Approve — verified hole-in-one</option><option value="reject">Reject</option></Select>
                      <Textarea name="reason" placeholder="Reason / what you checked (recorded and, for rejections, summarised to the player)" rows={4} aria-label="Reason" />
                      <SubmitButton size="lg" confirm="Record this decision? It cannot be changed here afterwards.">Record decision</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {decided.length > 0 && (
        <Card className="mt-8">
          <div className="border-b border-line px-5 py-4 font-semibold">Decided claims</div>
          <ul className="divide-y divide-line text-sm">
            {decided.map(({ claim, customer, competition }) => (
              <li key={claim.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span>{customer.firstName} {customer.lastName} · {competition.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={claim.status === "approved" ? "green" : "danger"}>{claim.status}</Badge>
                  {claim.status === "approved" && <span className="text-muted">{claim.jackpotEligible ? `jackpot ${formatPence(claim.jackpotAmountPence ?? 0)}` : `no jackpot: ${claim.jackpotIneligibleReason}`}</span>}
                  {claim.status === "approved" && <a className="text-green underline" href={`/share/hio/${claim.id}`} target="_blank">card</a>}
                  <span className="text-muted">by {name(claim.reviewedByUserId)} · {formatLocal(claim.reviewedAt, "d LLL")}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
