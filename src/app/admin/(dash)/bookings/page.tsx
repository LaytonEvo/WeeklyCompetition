import { and, asc, eq, gte, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { cancelBookingAction, moveBookingAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, Checkbox, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/db";
import { bookings, competitions, customers, payments } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { formatPence } from "@/lib/money";
import { can } from "@/lib/permissions";
import { DEFAULT_TZ, formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireStaffPage("booking.view");
  const { date } = await searchParams;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? DateTime.fromISO(date, { zone: DEFAULT_TZ }) : DateTime.now().setZone(DEFAULT_TZ);
  const rows = await db
    .select({ b: bookings, c: customers, comp: competitions, p: payments })
    .from(bookings)
    .leftJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(competitions, eq(competitions.id, bookings.competitionId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(gte(bookings.startsAt, day.startOf("day").toUTC().toJSDate()), lt(bookings.startsAt, day.endOf("day").toUTC().toJSDate())))
    .orderBy(asc(bookings.startsAt));
  const manage = can(user.role, "booking.manage");
  const tone = { held: "warn", confirmed: "blue", checked_in: "green", completed: "neutral", no_show: "danger", cancelled: "neutral", expired: "neutral" } as const;
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        title="Bookings"
        description={day.toFormat("cccc d LLLL yyyy")}
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton variant="secondary" href={`?date=${day.minus({ days: 1 }).toISODate()}`}>← Prev</LinkButton>
            <LinkButton variant="secondary" href="?">Today</LinkButton>
            <LinkButton variant="secondary" href={`?date=${day.plus({ days: 1 }).toISODate()}`}>Next →</LinkButton>
            <form className="flex gap-2"><Input type="date" name="date" defaultValue={day.toISODate()!} aria-label="Date" /><button className="sr-only">Go</button></form>
          </div>
        }
      />
      <Card>
        <Table>
          <thead><tr><Th>Time</Th><Th>Customer</Th><Th>Rounds</Th><Th>Source</Th><Th>Payment</Th><Th>Status</Th>{manage && <Th>Actions</Th>}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={7} className="py-10 text-center text-muted">No bookings on this day.</Td></tr>}
            {rows.map(({ b, c, comp, p }) => (
              <tr key={b.id} className="align-top">
                <Td className="whitespace-nowrap font-semibold tabular">{formatLocal(b.startsAt, "HH:mm")}–{formatLocal(b.endsAt, "HH:mm")}<div className="font-mono text-xs font-normal text-muted">{b.checkinCode}</div></Td>
                <Td>{c ? <Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-pine">{c.firstName} {c.lastName}</Link> : "—"}<div className="text-xs text-muted">{comp.name}</div></Td>
                <Td>{b.roundsQty}</Td>
                <Td className="text-sm">{b.source.replaceAll("_", "-")}{b.utmSource ? <div className="text-xs text-muted">{b.utmSource}{b.utmCampaign ? ` / ${b.utmCampaign}` : ""}</div> : null}</Td>
                <Td className="text-sm">{p ? `${p.amountPence ? formatPence(p.amountPence) : "Free"} · ${p.status.replaceAll("_", " ")}` : "—"}</Td>
                <Td><Badge tone={tone[b.status]}>{b.status.replaceAll("_", " ")}</Badge>{b.cancelReason && <div className="mt-1 max-w-48 text-xs text-muted">{b.cancelReason}</div>}</Td>
                {manage && (
                  <Td>
                    {["confirmed", "no_show", "held"].includes(b.status) && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-medium text-green">Move / cancel</summary>
                        <div className="mt-2 w-72 space-y-3">
                          <ActionForm action={moveBookingAction} className="space-y-2">
                            <input type="hidden" name="id" value={b.id} />
                            <div className="flex gap-2"><Input type="date" name="date" defaultValue={formatLocal(b.startsAt, "yyyy-LL-dd")} aria-label="New date" /><Input type="time" name="time" step={600} defaultValue={formatLocal(b.startsAt, "HH:mm")} aria-label="New time" /></div>
                            {can(user.role, "availability.override") && <Checkbox name="override" label="Override availability" />}
                            <SubmitButton size="sm" variant="secondary">Move</SubmitButton>
                          </ActionForm>
                          <ActionForm action={cancelBookingAction} className="space-y-2 border-t border-line pt-3">
                            <input type="hidden" name="id" value={b.id} />
                            <Input name="reason" placeholder="Cancellation reason" aria-label="Reason" />
                            <Checkbox name="notify" defaultChecked label="Email the customer" />
                            <SubmitButton size="sm" variant="danger" confirm="Cancel this booking?">Cancel booking</SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
