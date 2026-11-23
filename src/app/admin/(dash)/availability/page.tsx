import { asc, eq, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { addBlock, addRule, deleteBlock, deleteRule, updateSimulator } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { db } from "@/db";
import { availabilityRules, blockedPeriods, competitions, simulators } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { DEFAULT_TZ, formatLocal } from "@/lib/time";
import { computeSlots } from "@/server/availability";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulator availability" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ sim?: string }> }) {
  await requireStaffPage("availability.manage");
  const sims = await db.select().from(simulators);
  const { sim: simParam } = await searchParams;
  const sim = sims.find((s) => s.id === simParam) ?? sims[0];
  if (!sim) return <div className="p-8">No simulator configured.</div>;
  const rules = await db.select().from(availabilityRules).where(eq(availabilityRules.simulatorId, sim.id)).orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime));
  const blocks = await db
    .select()
    .from(blockedPeriods)
    .where(eq(blockedPeriods.simulatorId, sim.id))
    .orderBy(asc(blockedPeriods.startsAt));
  const upcomingBlocks = blocks.filter((b) => b.recurringWeekday || (b.endsAt && b.endsAt > new Date()));
  const [comp] = await db.select().from(competitions).where(or(eq(competitions.status, "open"), eq(competitions.status, "scheduled"))).orderBy(asc(competitions.startsAt)).limit(1);
  const today = DateTime.now().setZone(DEFAULT_TZ);
  const preview = comp
    ? await computeSlots({ simulatorId: sim.id, window: comp, fromDate: today.toISODate()!, toDate: today.plus({ days: 6 }).toISODate()!, staffView: true })
    : [];

  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Simulator availability" description="Competition sessions are offered only inside opening hours, within competition windows (if any are set), and outside blocked periods such as fittings." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Simulator" />
          <ActionForm action={updateSimulator} className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="id" value={sim.id} />
            <Field label="Name" htmlFor="sname"><Input id="sname" name="name" defaultValue={sim.name} /></Field>
            <Field label="Session length (minutes)" htmlFor="slot" hint="Per round"><Input id="slot" name="slotMinutes" type="number" min={5} max={60} defaultValue={sim.slotMinutes} /></Field>
            <Field label="Simultaneous bookings" htmlFor="cap" hint="Normally 1"><Input id="cap" name="slotCapacity" type="number" min={1} max={4} defaultValue={sim.slotCapacity} /></Field>
            <Field label="Unavailable reason" htmlFor="ur"><Input id="ur" name="unavailableReason" defaultValue={sim.unavailableReason ?? ""} /></Field>
            <Checkbox name="available" defaultChecked={sim.available} label="Simulator available for competition sessions" className="sm:col-span-2" />
            <div><SubmitButton>Save</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Weekly hours" description="Opening hours, and optional competition windows that restrict sessions further (e.g. mornings kept for fittings)." />
          <ul className="divide-y divide-line text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-2">
                <span><span className="inline-block w-10 font-semibold">{DAYS[r.weekday - 1]}</span> {r.startTime}–{r.endTime} <Badge tone={r.kind === "opening_hours" ? "neutral" : "green"}>{r.kind === "opening_hours" ? "Open" : "Competition window"}</Badge></span>
                <ActionForm action={deleteRule}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={addRule} resetOnSuccess className="grid gap-3 border-t border-line p-5 sm:grid-cols-4">
            <input type="hidden" name="simulatorId" value={sim.id} />
            <div className="flex flex-wrap gap-2 sm:col-span-4">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" name="weekday" value={i + 1} className="accent-[#003d27]" />{d}</label>)}</div>
            <Select name="kind" aria-label="Type"><option value="opening_hours">Opening hours</option><option value="competition_window">Competition window</option></Select>
            <Input name="startTime" type="time" required aria-label="Start" />
            <Input name="endTime" type="time" required aria-label="End" />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Blocked periods" description="Fitting appointments, maintenance, closures. One-off or weekly recurring." />
          <ul className="divide-y divide-line text-sm">
            {upcomingBlocks.length === 0 && <li className="px-5 py-4 text-muted">No upcoming blocks.</li>}
            {upcomingBlocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span>
                  <Badge tone={b.kind === "fitting" ? "gold" : "neutral"}>{b.kind.replaceAll("_", " ")}</Badge> <span className="font-medium">{b.title}</span>
                  <span className="block text-xs text-muted">{b.recurringWeekday ? `Every ${DAYS[b.recurringWeekday - 1]} ${b.recurringStart}–${b.recurringEnd}${b.recurringUntil ? ` until ${formatLocal(b.recurringUntil, "d LLL")}` : ""}` : `${formatLocal(b.startsAt!, "ccc d LLL HH:mm")} – ${formatLocal(b.endsAt!, "ccc d LLL HH:mm")}`}</span>
                </span>
                <ActionForm action={deleteBlock}><input type="hidden" name="id" value={b.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={addBlock} resetOnSuccess className="grid gap-3 border-t border-line p-5 sm:grid-cols-3">
            <input type="hidden" name="simulatorId" value={sim.id} />
            <Select name="kind" aria-label="Kind"><option value="fitting">Fitting appointment</option><option value="maintenance">Maintenance</option><option value="closed">Closed</option><option value="private_event">Private event</option><option value="other">Other</option></Select>
            <Input name="title" placeholder="Title (no customer names needed)" className="sm:col-span-2" aria-label="Title" />
            <Field label="Date (one-off)" htmlFor="bd"><Input id="bd" name="date" type="date" /></Field>
            <Field label="From" htmlFor="bs"><Input id="bs" name="startTime" type="time" required /></Field>
            <Field label="To" htmlFor="be"><Input id="be" name="endTime" type="time" required /></Field>
            <Checkbox name="recurring" label="Repeat weekly instead" />
            <Select name="weekday" aria-label="Weekday">{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select>
            <Field label="Repeat until (optional)" htmlFor="bu"><Input id="bu" name="until" type="date" /></Field>
            <div className="sm:col-span-3"><SubmitButton>Add block</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader title="Next 7 days" description={comp ? `Sessions for ${comp.name}` : "No published competition"} />
          <div className="space-y-3 p-5">
            {preview.map((d) => {
              const free = d.slots.filter((s) => s.status === "available").length;
              return (
                <div key={d.date}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{d.label}</span><span className="text-muted">{d.closed ? "Closed" : `${free} free / ${d.slots.length}`}</span></div>
                  <div className="flex flex-wrap gap-0.5">
                    {d.slots.map((s) => (
                      <span key={s.startsAt.toISOString()} title={`${formatLocal(s.startsAt, "HH:mm")} ${s.status}${s.reason ? ` — ${s.reason}` : ""}`} className={`h-4 w-2.5 rounded-sm ${s.status === "available" ? "bg-green/70" : s.status === "full" ? "bg-gold" : s.status === "past" ? "bg-zinc-200" : "bg-zinc-400"}`} />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex gap-4 pt-2 text-xs text-muted"><span><span className="mr-1 inline-block h-3 w-2 rounded-sm bg-green/70" />free</span><span><span className="mr-1 inline-block h-3 w-2 rounded-sm bg-gold" />booked</span><span><span className="mr-1 inline-block h-3 w-2 rounded-sm bg-zinc-400" />blocked</span></div>
          </div>
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted">External calendar sync (e.g. Google Calendar or fitting software) can be added through the calendar adapter interface — see ARCHITECTURE.md. It is not connected.</p>
    </div>
  );
}
