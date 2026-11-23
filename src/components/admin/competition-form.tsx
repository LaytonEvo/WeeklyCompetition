import { DateTime } from "luxon";
import type { ReactNode } from "react";
import { Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "../ui";

export type CompetitionFormValues = {
  name: string;
  description: string;
  format: string;
  locationId: string;
  simulatorId: string;
  startsAt: Date;
  endsAt: Date;
  entryMode: "paid" | "free";
  entryFeePence: number;
  shotsPerRound: number;
  maxEntrants: number | null;
  maxRoundsPerCustomer: number | null;
  requireOnGreen: boolean;
  holeName: string;
  holeDistanceYards: number | null;
  simulatorSettings: string;
  eligibility: string;
  tiePolicy: string;
  tiePolicyText: string;
  rulesMarkdown: string;
  termsVersion: string;
  promoImageUrl: string | null;
  showRoundsCount: boolean;
  jackpotEnabled: boolean;
  jackpotAmountPence: number;
  jackpotMaxWinners: number | null;
  jackpotMaxPerPlayer: number;
  jackpotMaxLiabilityPence: number | null;
  jackpotSubsequentQualify: boolean;
  hioCountsForWeekly: boolean;
  jackpotClaimDays: number;
  jackpotFundingId: string | null;
  prizes: { rank: number; amountPence: number; description: string }[];
};

const pounds = (p: number | null | undefined) => (p === null || p === undefined ? "" : (p / 100).toFixed(2).replace(/\.00$/, ""));
const local = (d: Date, f: string) => DateTime.fromJSDate(d, { zone: "Europe/London" }).toFormat(f);

/**
 * Competition editor fields. Rendered inside an ActionForm by the page.
 * `locked` disables fields that may not change once entries exist.
 */
export function CompetitionFields({
  v,
  locations,
  simulators,
  funding,
  locked = false,
  extra,
  templateMode = false,
  templateDefaults = { startWeekday: 1, durationDays: 7 },
}: {
  templateDefaults?: { startWeekday: number; durationDays: number };
  v: CompetitionFormValues;
  locations: { id: string; name: string }[];
  simulators: { id: string; name: string; locationId: string }[];
  funding: { id: string; label: string }[];
  locked?: boolean;
  extra?: ReactNode;
  templateMode?: boolean;
}) {
  return (
    <div className="space-y-6">
      {locked && (
        <p className="rounded-2xl bg-warn-50 px-4 py-3 text-sm text-[#6d3f06] ring-1 ring-warn/20">
          Entries exist, so scoring rules, entry fee, shots per round and the tie procedure are locked. Prizes and the jackpot can only be increased; the deadline can only be extended. Every change needs a reason and entrants are notified.
        </p>
      )}
      <Card>
        <CardHeader title="Basics" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {!templateMode && <Field label="Name" htmlFor="name" className="sm:col-span-2"><Input id="name" name="name" defaultValue={v.name} required /></Field>}
          <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={v.description} rows={2} /></Field>
          <Field label="Format" htmlFor="format" hint="Only closest-to-the-pin is enabled in this release.">
            <Select id="format" name="format" defaultValue={v.format} disabled={locked}>
              <option value="closest_to_pin">Closest to the pin</option>
              <option value="longest_drive" disabled>Longest drive (coming later)</option>
              <option value="putting_challenge" disabled>Putting challenge (coming later)</option>
            </Select>
            {locked && <input type="hidden" name="format" value={v.format} />}
          </Field>
          <Field label="Location" htmlFor="locationId">
            <Select id="locationId" name="locationId" defaultValue={v.locationId}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
          <Field label="Simulator" htmlFor="simulatorId">
            <Select id="simulatorId" name="simulatorId" defaultValue={v.simulatorId}>{simulators.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
          <Field label="Promotional image URL" htmlFor="promoImageUrl"><Input id="promoImageUrl" name="promoImageUrl" type="url" defaultValue={v.promoImageUrl ?? ""} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Schedule" description="Times are UK local time (Europe/London); BST/GMT changes are handled automatically." />
        <div className="grid gap-4 p-5 sm:grid-cols-4">
          {templateMode ? (
            <>
              <Field label="Starts on" htmlFor="startWeekday"><Select id="startWeekday" name="startWeekday" defaultValue={String(templateDefaults.startWeekday)}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></Field>
              <Field label="Start time" htmlFor="startTime"><Input id="startTime" name="startTime" type="time" defaultValue={local(v.startsAt, "HH:mm")} /></Field>
              <Field label="Duration (days)" htmlFor="durationDays"><Input id="durationDays" name="durationDays" type="number" min={1} max={31} defaultValue={templateDefaults.durationDays} /></Field>
              <Field label="Close time (last day)" htmlFor="endTime"><Input id="endTime" name="endTime" type="time" defaultValue={local(v.endsAt, "HH:mm")} /></Field>
              <input type="hidden" name="startDate" value={local(v.startsAt, "yyyy-LL-dd")} />
              <input type="hidden" name="endDate" value={local(v.endsAt, "yyyy-LL-dd")} />
            </>
          ) : (
            <>
              <Field label="Start date" htmlFor="startDate"><Input id="startDate" name="startDate" type="date" defaultValue={local(v.startsAt, "yyyy-LL-dd")} readOnly={locked} required /></Field>
              <Field label="Start time" htmlFor="startTime"><Input id="startTime" name="startTime" type="time" defaultValue={local(v.startsAt, "HH:mm")} readOnly={locked} required /></Field>
              <Field label="Closing date" htmlFor="endDate"><Input id="endDate" name="endDate" type="date" defaultValue={local(v.endsAt, "yyyy-LL-dd")} required /></Field>
              <Field label="Closing time" htmlFor="endTime"><Input id="endTime" name="endTime" type="time" defaultValue={local(v.endsAt, "HH:mm")} required /></Field>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Entry & scoring" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Entry mode" htmlFor="entryMode" hint="Paid entry stays locked until legal approval is recorded.">
            <Select id="entryMode" name="entryMode" defaultValue={v.entryMode} disabled={locked}>
              <option value="paid">Paid-entry skill competition</option>
              <option value="free">Free-entry promotion</option>
            </Select>
            {locked && <input type="hidden" name="entryMode" value={v.entryMode} />}
          </Field>
          <Field label="Entry fee per round (£)" htmlFor="entryFee"><Input id="entryFee" name="entryFee" inputMode="decimal" defaultValue={pounds(v.entryFeePence)} readOnly={locked} /></Field>
          <Field label="Shots per round" htmlFor="shotsPerRound"><Input id="shotsPerRound" name="shotsPerRound" type="number" min={1} max={20} defaultValue={v.shotsPerRound} readOnly={locked} /></Field>
          <Field label="Max rounds per player" htmlFor="maxRoundsPerCustomer" hint="Blank = unlimited"><Input id="maxRoundsPerCustomer" name="maxRoundsPerCustomer" type="number" min={1} defaultValue={v.maxRoundsPerCustomer ?? ""} /></Field>
          <Field label="Max entrants" htmlFor="maxEntrants" hint="Blank = unlimited"><Input id="maxEntrants" name="maxEntrants" type="number" min={1} defaultValue={v.maxEntrants ?? ""} /></Field>
          <Field label="Terms version" htmlFor="termsVersion" hint="Must match a recorded legal approval."><Input id="termsVersion" name="termsVersion" defaultValue={v.termsVersion} readOnly={locked} required /></Field>
          <div className="space-y-2 sm:col-span-3">
            <Checkbox name="requireOnGreen" defaultChecked={v.requireOnGreen} disabled={locked} label="Shots must finish on the green to count" />
            {locked && v.requireOnGreen && <input type="hidden" name="requireOnGreen" value="on" />}
            <Checkbox name="showRoundsCount" defaultChecked={v.showRoundsCount} label="Show number of rounds on the leaderboard" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Featured hole & simulator" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Hole name" htmlFor="holeName" className="sm:col-span-2"><Input id="holeName" name="holeName" defaultValue={v.holeName} /></Field>
          <Field label="Distance (yards)" htmlFor="holeDistanceYards"><Input id="holeDistanceYards" name="holeDistanceYards" type="number" defaultValue={v.holeDistanceYards ?? ""} /></Field>
          <Field label="Simulator settings" htmlFor="simulatorSettings" className="sm:col-span-3" hint="Published so every entrant plays the same conditions."><Textarea id="simulatorSettings" name="simulatorSettings" defaultValue={v.simulatorSettings} rows={2} /></Field>
          <Field label="Eligibility" htmlFor="eligibility" className="sm:col-span-3"><Textarea id="eligibility" name="eligibility" defaultValue={v.eligibility} rows={2} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Weekly prizes" description="Amounts in pounds. Leave a row blank for no prize." />
        <div className="space-y-3 p-5">
          {[1, 2, 3, 4, 5].map((i) => {
            const p = v.prizes.find((x) => x.rank === i);
            return (
              <div key={i} className="grid grid-cols-[60px_140px_1fr] items-center gap-3">
                <span className="text-sm font-semibold text-muted">#{i}</span>
                <Input name={`prize${i}`} aria-label={`Prize ${i} amount`} inputMode="decimal" placeholder="£" defaultValue={p ? pounds(p.amountPence) : ""} />
                <Input name={`prize${i}desc`} aria-label={`Prize ${i} description`} placeholder="Description (e.g. £100 cash, or a new putter)" defaultValue={p?.description ?? ""} />
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Ties" description="Must be published before opening and cannot change afterwards." />
        <div className="grid gap-4 p-5">
          <Field label="Tie procedure" htmlFor="tiePolicy">
            <Select id="tiePolicy" name="tiePolicy" defaultValue={v.tiePolicy} disabled={locked}>
              <option value="equal_rank_split">Equal ranking — tied players share pooled prizes</option>
              <option value="countback">Countback — compare next-best valid shots</option>
              <option value="playoff">Playoff — tied prize positions decided by a recorded playoff</option>
            </Select>
            {locked && <input type="hidden" name="tiePolicy" value={v.tiePolicy} />}
          </Field>
          <Field label="Published tie wording" htmlFor="tiePolicyText"><Textarea id="tiePolicyText" name="tiePolicyText" defaultValue={v.tiePolicyText} rows={2} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Hole-in-one jackpot" description="Publication is blocked unless the maximum possible payout is covered by confirmed funding/insurance." />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-3">
            <Checkbox name="jackpotEnabled" defaultChecked={v.jackpotEnabled} label="Jackpot enabled" />
            <Checkbox name="jackpotSubsequentQualify" defaultChecked={v.jackpotSubsequentQualify} label="Subsequent verified hole-in-ones also qualify (up to the caps)" />
            <Checkbox name="hioCountsForWeekly" defaultChecked={v.hioCountsForWeekly} disabled={locked} label="A verified hole-in-one also counts (as 0.00 m) for the weekly prize" />
            {locked && v.hioCountsForWeekly && <input type="hidden" name="hioCountsForWeekly" value="on" />}
          </div>
          <Field label="Jackpot (£)" htmlFor="jackpotAmount"><Input id="jackpotAmount" name="jackpotAmount" inputMode="decimal" defaultValue={pounds(v.jackpotAmountPence)} /></Field>
          <Field label="Max jackpot winners" htmlFor="jackpotMaxWinners"><Input id="jackpotMaxWinners" name="jackpotMaxWinners" type="number" min={1} defaultValue={v.jackpotMaxWinners ?? ""} /></Field>
          <Field label="Max per player" htmlFor="jackpotMaxPerPlayer"><Input id="jackpotMaxPerPlayer" name="jackpotMaxPerPlayer" type="number" min={1} defaultValue={v.jackpotMaxPerPlayer} /></Field>
          <Field label="Max total liability (£)" htmlFor="jackpotMaxLiability"><Input id="jackpotMaxLiability" name="jackpotMaxLiability" inputMode="decimal" defaultValue={pounds(v.jackpotMaxLiabilityPence)} /></Field>
          <Field label="Claim period (days)" htmlFor="jackpotClaimDays"><Input id="jackpotClaimDays" name="jackpotClaimDays" type="number" defaultValue={v.jackpotClaimDays} /></Field>
          <Field label="Funding / insurance" htmlFor="jackpotFundingId">
            <Select id="jackpotFundingId" name="jackpotFundingId" defaultValue={v.jackpotFundingId ?? ""}>
              <option value="">— none —</option>
              {funding.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Rules" description="Markdown. Shown publicly. Draft rules must be legally reviewed before launch." />
        <div className="p-5">
          <Textarea name="rulesMarkdown" defaultValue={v.rulesMarkdown} rows={14} className="font-mono text-sm" aria-label="Rules" />
        </div>
      </Card>
      {extra}
    </div>
  );
}
