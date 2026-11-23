import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { saveTemplateAction } from "@/app/admin/actions/competitions";
import { CompetitionFields } from "@/components/admin/competition-form";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { competitionTemplates } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { competitionWindow } from "@/lib/time";
import { formOptions } from "@/server/admin-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("competition.manage");
  const { id } = await params;
  const [t] = await db.select().from(competitionTemplates).where(eq(competitionTemplates.id, id));
  if (!t) notFound();
  const opts = await formOptions();
  const c = t.config;
  const win = competitionWindow("2026-01-05", c.startTime, c.durationDays, c.endTime);
  return (
    <div className="mx-auto max-w-4xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader eyebrow="Template" title={t.name} description="Defaults used when the scheduler drafts each week's competition. Changing the template never alters existing competitions." />
      <ActionForm action={saveTemplateAction}>
        <input type="hidden" name="templateId" value={t.id} />
        <input type="hidden" name="name" value={t.name} />
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Template name" htmlFor="templateName"><Input id="templateName" name="templateName" defaultValue={t.name} /></Field>
          <Field label="Competition name pattern" htmlFor="namePattern" hint="{n} = week number, {week} = ISO week"><Input id="namePattern" name="namePattern" defaultValue={t.namePattern} /></Field>
          <Checkbox name="autoCreateWeekly" defaultChecked={t.autoCreateWeekly} label="Automatically draft upcoming weeks (still require approval)" className="sm:col-span-2" />
        </Card>
        <CompetitionFields {...opts} templateMode templateDefaults={{ startWeekday: c.startWeekday, durationDays: c.durationDays }} v={{ ...c, name: t.name, locationId: t.locationId, simulatorId: t.simulatorId, ...win, promoImageUrl: null, jackpotFundingId: c.jackpotFundingId ?? null, holeDistanceYards: c.holeDistanceYards || null }} />
        <SubmitButton size="lg">Save template</SubmitButton>
      </ActionForm>
    </div>
  );
}
