import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { prizeAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { competitions, customers, prizeAwards } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMm } from "@/lib/distance";
import { formatPence } from "@/lib/money";
import { formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winners & prizes" };

const NEXT: Record<string, string[]> = { awaiting_claim: ["claimed", "fulfilled", "expired", "cancelled"], claimed: ["fulfilled", "cancelled"], expired: ["awaiting_claim"], verified: ["awaiting_claim", "cancelled"], provisional: ["cancelled"] };

export default async function WinnersAdmin() {
  await requireStaffPage("prize.manage");
  const rows = await db
    .select({ a: prizeAwards, c: customers, comp: competitions })
    .from(prizeAwards)
    .innerJoin(customers, eq(customers.id, prizeAwards.customerId))
    .innerJoin(competitions, eq(competitions.id, prizeAwards.competitionId))
    .orderBy(desc(prizeAwards.createdAt))
    .limit(300);
  const outstanding = rows.filter((r) => ["awaiting_claim", "claimed", "verified"].includes(r.a.status)).reduce((s, r) => s + r.a.prizeAmountPence, 0);
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Winners & prizes" description={`Prize money is paid manually (never via Stripe). Outstanding liability: ${formatPence(outstanding)}.`} />
      <Card>
        <Table>
          <thead><tr><Th>Competition</Th><Th>Winner</Th><Th>Result</Th><Th>Prize</Th><Th>Status</Th><Th>Update</Th></tr></thead>
          <tbody>
            {rows.map(({ a, c, comp }) => (
              <tr key={a.id} className="align-top">
                <Td className="text-sm">{comp.name}<div className="text-xs text-muted">{a.kind === "jackpot" ? "Hole-in-one jackpot" : `Position ${a.rank}${a.splitWays > 1 ? ` (${a.splitWays}-way split)` : ""}`}</div></Td>
                <Td><Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-pine">{c.firstName} {c.lastName}</Link><div className="text-xs text-muted">Notified: {a.notificationStatus ?? "—"}</div></Td>
                <Td className="font-display text-lg font-bold text-pine">{a.distanceMm === 0 ? "ACE" : a.distanceMm !== null ? formatMm(a.distanceMm, 3) : "—"}</Td>
                <Td>{a.prizeAmountPence ? formatPence(a.prizeAmountPence) : a.prizeDescription}<div className="text-xs text-muted">{a.claimDeadline ? `Claim by ${formatLocal(a.claimDeadline, "d LLL yyyy")}` : ""}</div></Td>
                <Td><Badge tone={a.status === "fulfilled" ? "green" : a.status === "awaiting_claim" ? "gold" : a.status === "cancelled" || a.status === "expired" ? "danger" : "blue"}>{a.status.replaceAll("_", " ")}</Badge>
                  {a.paidAt && <div className="mt-1 text-xs text-muted">Paid {a.paidAmountPence !== null ? formatPence(a.paidAmountPence) : ""} by {a.paymentMethod} · {a.paymentReference} · {formatLocal(a.paidAt, "d LLL")}</div>}
                  {a.notes && <div className="mt-1 max-w-56 whitespace-pre-line text-xs text-muted">{a.notes}</div>}
                </Td>
                <Td>
                  {NEXT[a.status] && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-green">Update</summary>
                      <ActionForm action={prizeAction} className="mt-2 w-64 space-y-2">
                        <input type="hidden" name="id" value={a.id} />
                        <Select name="to" aria-label="New status">{NEXT[a.status].map((n) => <option key={n} value={n}>{n.replaceAll("_", " ")}</option>)}</Select>
                        <Input name="paidAmount" placeholder="Amount paid £ (when fulfilled)" defaultValue={(a.prizeAmountPence / 100).toFixed(2)} aria-label="Amount paid" />
                        <Input name="paymentMethod" placeholder="Method (bank transfer, cash…)" aria-label="Method" />
                        <Input name="paymentReference" placeholder="Transaction reference" aria-label="Reference" />
                        <Input name="notes" placeholder="Notes" aria-label="Notes" />
                        <SubmitButton size="sm">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                  {["awaiting_claim", "claimed", "fulfilled"].includes(a.status) && <a href={`/share/winner/${a.id}`} target="_blank" className="mt-2 block text-xs text-green underline">Winner card</a>}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td colSpan={6} className="py-10 text-center text-muted">No prizes awarded yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
