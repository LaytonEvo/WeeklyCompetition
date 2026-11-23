import { DateTime } from "luxon";
import { createCompetitionAction } from "@/app/admin/actions/competitions";
import { CompetitionFields } from "@/components/admin/competition-form";
import { ActionForm, SubmitButton } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { competitionTemplates } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { DRAFT_RULES_MD } from "@/lib/legal-drafts";
import { getSettings } from "@/lib/settings";
import { competitionWindow } from "@/lib/time";
import { formOptions } from "@/server/admin-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "New competition" };

export default async function NewCompetition() {
  await requireStaffPage("competition.manage");
  const [opts, [tpl], s] = await Promise.all([formOptions(), db.select().from(competitionTemplates).limit(1), getSettings()]);
  const cfg = tpl?.config;
  const nextMonday = DateTime.now().setZone("Europe/London").startOf("week").plus({ weeks: 1 }).toISODate()!;
  const win = competitionWindow(nextMonday, cfg?.startTime ?? "09:00", cfg?.durationDays ?? 7, cfg?.endTime ?? "18:00");
  return (
    <div className="mx-auto max-w-4xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader eyebrow="Competitions" title="New competition" description="Saved as a draft. Nothing is public until it is approved and published." />
      <ActionForm action={createCompetitionAction}>
        <CompetitionFields
          {...opts}
          v={{
            name: tpl ? tpl.namePattern.replace("{n}", String(tpl.nextSequence)) : "Pin Hunters — Week 1",
            description: cfg?.description ?? "",
            format: "closest_to_pin",
            locationId: opts.locations[0]?.id ?? "",
            simulatorId: opts.simulators[0]?.id ?? "",
            ...win,
            entryMode: cfg?.entryMode ?? "free",
            entryFeePence: cfg?.entryFeePence ?? 500,
            shotsPerRound: cfg?.shotsPerRound ?? 5,
            maxEntrants: cfg?.maxEntrants ?? null,
            maxRoundsPerCustomer: cfg?.maxRoundsPerCustomer ?? null,
            requireOnGreen: cfg?.requireOnGreen ?? true,
            holeName: cfg?.holeName ?? "",
            holeDistanceYards: cfg?.holeDistanceYards ?? null,
            simulatorSettings: cfg?.simulatorSettings ?? "",
            eligibility: cfg?.eligibility ?? "",
            tiePolicy: cfg?.tiePolicy ?? "equal_rank_split",
            tiePolicyText: cfg?.tiePolicyText ?? "",
            rulesMarkdown: cfg?.rulesMarkdown ?? DRAFT_RULES_MD,
            termsVersion: cfg?.termsVersion ?? s.legalTexts.termsVersion,
            promoImageUrl: null,
            showRoundsCount: true,
            jackpotEnabled: cfg?.jackpotEnabled ?? false,
            jackpotAmountPence: cfg?.jackpotAmountPence ?? 100_000,
            jackpotMaxWinners: cfg?.jackpotMaxWinners ?? 1,
            jackpotMaxPerPlayer: cfg?.jackpotMaxPerPlayer ?? 1,
            jackpotMaxLiabilityPence: cfg?.jackpotMaxLiabilityPence ?? null,
            jackpotSubsequentQualify: cfg?.jackpotSubsequentQualify ?? true,
            hioCountsForWeekly: cfg?.hioCountsForWeekly ?? true,
            jackpotClaimDays: cfg?.jackpotClaimDays ?? 30,
            jackpotFundingId: opts.funding[0]?.id ?? null,
            prizes: cfg?.prizes ?? [{ rank: 1, amountPence: 10_000, description: "£100" }],
          }}
        />
        <div className="sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
          <SubmitButton size="lg">Save draft</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
