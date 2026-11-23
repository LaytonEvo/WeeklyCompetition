import Link from "next/link";
import { saveSettingsSection } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardHeader, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const TITLES: Record<string, [string, string]> = {
  brand: ["Brand", "Names, tagline, logo and colours used across the site, emails and share cards."],
  store: ["Store", "Address and contact details shown publicly."],
  links: ["Links", "Club fitting booking URL and social links."],
  locale: ["Locale", "Currency and timezone (fixed to GBP and Europe/London in this release)."],
  booking: ["Booking & policies", "Hold time during checkout, booking horizon, reminders, no-show and refund policies."],
  leaderboard: ["Leaderboard & TV", "Display preferences."],
  sharing: ["Social sharing", "Share cards and hashtags."],
  privacy: ["Privacy & retention", "Notice versions, retention periods and minimum age."],
  attribution: ["Attribution", "Window for attributing fitting enquiries to the competition."],
  legalTexts: ["Terms & privacy text", "Markdown. Leave blank to show the DRAFT text. Must be reviewed by the business/legal adviser."],
};
const LABEL = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export default async function SettingsPage() {
  await requireStaffPage("settings.manage");
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-4xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        title="Settings"
        description="Business-editable configuration. API keys and secrets are NOT stored here — they live in the hosting platform's environment variables."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/settings/legal" className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-white">Legal & launch gate</Link>
            <Link href="/admin/settings/users" className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-line">Staff users</Link>
          </div>
        }
      />
      <div className="space-y-6">
        {Object.entries(s).map(([section, values]) => {
          const flat: [string, unknown][] = [];
          for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
            if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v)) flat.push([`${k}.${k2}`, v2]);
            else flat.push([k, v]);
          }
          const booleans = flat.filter(([, v]) => typeof v === "boolean").map(([k]) => `${section}.${k}`);
          return (
            <Card key={section}>
              <CardHeader title={TITLES[section]?.[0] ?? section} description={TITLES[section]?.[1]} />
              <ActionForm action={saveSettingsSection} className="grid gap-4 p-5 sm:grid-cols-2">
                <input type="hidden" name="_booleans" value={booleans.join(",")} />
                {flat.map(([k, v]) => {
                  const name = `${section}.${k}`;
                  const label = LABEL(k.split(".").pop()!);
                  if (typeof v === "boolean") return <Checkbox key={k} name={name} defaultChecked={v} label={label} className="sm:col-span-2" />;
                  if (typeof v === "number") return <Field key={k} label={label} htmlFor={name}><Input id={name} name={name} type="number" defaultValue={v} /></Field>;
                  const long = String(v).length > 80 || /Markdown|Policy/i.test(k);
                  return (
                    <Field key={k} label={label} htmlFor={name} className={long ? "sm:col-span-2" : ""}>
                      {long ? <Textarea id={name} name={name} defaultValue={String(v)} rows={/Markdown/.test(k) ? 12 : 3} className={/Markdown/.test(k) ? "font-mono text-sm" : ""} /> : <Input id={name} name={name} defaultValue={String(v)} readOnly={section === "locale"} />}
                    </Field>
                  );
                })}
                <div className="sm:col-span-2"><SubmitButton>Save {TITLES[section]?.[0] ?? section}</SubmitButton></div>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
