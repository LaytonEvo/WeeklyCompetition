import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { refundAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardHeader, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { competitions, customers, payments, refunds } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { stripeConfigured, stripeIsTestMode } from "@/lib/env";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { reconciliationIssues } from "@/server/payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const user = await requireStaffPage("payment.view");
  const [rows, issues, refundRows] = await Promise.all([
    db.select({ p: payments, c: customers, comp: competitions }).from(payments).leftJoin(customers, eq(customers.id, payments.customerId)).innerJoin(competitions, eq(competitions.id, payments.competitionId)).orderBy(desc(payments.createdAt)).limit(300),
    reconciliationIssues(),
    db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(50),
  ]);
  const tone = { paid: "green", paid_in_store: "green", complimentary: "blue", pending: "warn", failed: "danger", refunded: "neutral", partially_refunded: "warn", cancelled: "neutral", expired: "neutral" } as const;
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Payments" description={stripeConfigured() ? (stripeIsTestMode() ? "Stripe is in TEST mode — no real money is taken." : "Stripe LIVE mode.") : "Stripe is not configured — only in-store payments can be recorded."} />
      {issues.length > 0 && (
        <Alert tone="warn" title="Reconciliation issues" className="mb-6">
          <ul className="mt-1 list-disc pl-5">{issues.map((i) => <li key={i.id}>{i.issue} — {formatPence(Number(i.amount_pence))} ({String(i.id).slice(0, 8)})</li>)}</ul>
        </Alert>
      )}
      <Card>
        <Table>
          <thead><tr><Th>Date</Th><Th>Customer</Th><Th>Method</Th><Th>Amount</Th><Th>Status</Th><Th>Reference</Th>{can(user.role, "payment.refund") && <Th>Refund</Th>}</tr></thead>
          <tbody>
            {rows.map(({ p, c, comp }) => (
              <tr key={p.id} className="align-top">
                <Td className="whitespace-nowrap text-sm">{formatLocal(p.createdAt, "d LLL HH:mm")}</Td>
                <Td>{c ? <Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-pine">{c.firstName} {c.lastName}</Link> : "—"}<div className="text-xs text-muted">{comp.name} · {p.roundsQty} round(s)</div></Td>
                <Td className="text-sm">{p.method.replaceAll("_", " ")}</Td>
                <Td className="tabular">{formatPence(p.amountPence)}{p.refundedPence > 0 && <div className="text-xs text-danger">−{formatPence(p.refundedPence)} refunded</div>}</Td>
                <Td><Badge tone={tone[p.status]}>{p.status.replaceAll("_", " ")}</Badge>{p.authorisationReason && <div className="mt-1 max-w-48 text-xs text-muted">{p.authorisationReason}</div>}</Td>
                <Td className="max-w-40 truncate font-mono text-xs text-muted">{p.reference ?? p.stripePaymentIntentId ?? "—"}</Td>
                {can(user.role, "payment.refund") && (
                  <Td>
                    {["paid", "paid_in_store", "partially_refunded"].includes(p.status) && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-green">Refund</summary>
                        <ActionForm action={refundAction} className="mt-2 w-60 space-y-2">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="key" value={randomUUID()} />
                          <Input name="amount" defaultValue={((p.amountPence - p.refundedPence) / 100).toFixed(2)} aria-label="Amount £" />
                          <Input name="reason" placeholder="Reason" aria-label="Reason" />
                          <Input name="cancelRounds" type="number" min={0} max={p.roundsQty} defaultValue={0} aria-label="Unplayed rounds to cancel" title="Unplayed rounds to cancel" />
                          <p className="text-xs text-muted">{p.method === "stripe" ? "Refunded to the card via Stripe." : "Record a refund you've made in store (cash/terminal)."}</p>
                          <SubmitButton size="sm" variant="danger" confirm="Issue this refund?">Refund</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recent refunds" />
        <ul className="divide-y divide-line text-sm">{refundRows.map((r) => <li key={r.id} className="flex justify-between px-5 py-2.5"><span>{formatLocal(r.createdAt, "d LLL HH:mm")} · {r.reason}</span><span>{formatPence(r.amountPence)} · {r.status}{r.stripeRefundId ? ` · ${r.stripeRefundId}` : ""}</span></li>)}</ul>
      </Card>
    </div>
  );
}
