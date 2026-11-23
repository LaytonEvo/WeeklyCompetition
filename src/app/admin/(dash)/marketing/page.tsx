import { and, eq, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { Alert, Card, CardHeader, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { publicWinners } from "@/server/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing" };

const CHANNELS = [
  ["facebook", "paid_social"],
  ["instagram", "paid_social"],
  ["google", "cpc"],
  ["print", "local_press"],
  ["billboard", "outdoor"],
  ["golf_club", "partner"],
  ["instore", "poster"],
  ["qr", "qr_code"],
] as const;

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ source?: string; campaign?: string; path?: string }> }) {
  const user = await requireStaffPage("marketing.view");
  const sp = await searchParams;
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const [{ consented }] = await db.select({ consented: sql<number>`count(*)::int` }).from(customers).where(and(eq(customers.marketingEmailConsent, true), isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));
  const winners = await publicWinners(10);
  const src = CHANNELS.find((c) => c[0] === sp.source) ?? CHANNELS[0];
  const campaign = (sp.campaign || "pin_hunters_launch").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const path = ["/", "/enter", "/leaderboard"].includes(sp.path ?? "") ? sp.path! : "/";
  const url = `${base}${path}?utm_source=${src[0]}&utm_medium=${src[1]}&utm_campaign=${campaign}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#003d27", light: "#ffffff" } });
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Marketing" description="Campaign links, approved public results and consented audiences. Operational emails are separate from marketing." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Campaign link & QR builder" description="Every link records its source against the booking and customer." />
          <form className="grid gap-3 p-5 sm:grid-cols-3">
            <Select name="source" defaultValue={src[0]} aria-label="Channel">{CHANNELS.map((c) => <option key={c[0]} value={c[0]}>{c[0].replace("_", " ")}</option>)}</Select>
            <Input name="campaign" defaultValue={campaign} aria-label="Campaign" />
            <Select name="path" defaultValue={path} aria-label="Landing page"><option value="/">Homepage</option><option value="/enter">Booking</option><option value="/leaderboard">Leaderboard</option></Select>
            <button className="h-10 rounded-full bg-pine px-4 text-sm font-semibold text-white sm:col-span-3">Build link</button>
          </form>
          <div className="flex flex-wrap items-center gap-5 border-t border-line p-5">
            <div className="w-36 rounded-xl ring-1 ring-line" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="QR code" />
            <div className="min-w-0 flex-1">
              <div className="break-all rounded-xl bg-cream p-3 font-mono text-xs">{url}</div>
              <a download={`qr-${src[0]}-${campaign}.svg`} href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`} className="mt-2 inline-block text-sm font-semibold text-green underline">Download QR (SVG, print-ready)</a>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Consented audience" />
          <div className="p-5">
            <div className="font-display text-4xl font-bold">{consented}</div>
            <p className="text-sm text-muted">customers have opted in to marketing email.</p>
            {can(user.role, "marketing.export_consented") && <LinkButton href="/admin/export/marketing" variant="secondary" className="mt-4">Export consented list (CSV)</LinkButton>}
            <Alert className="mt-4">No CRM or Klaviyo integration is connected. Export the consented list and import it, or ask a developer to add a CRM adapter. Never import non-consented customers.</Alert>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Approved public results & assets" description="Only finalised results, with public display names." />
          <ul className="divide-y divide-line text-sm">
            {winners.length === 0 && <li className="px-5 py-4 text-muted">No finalised winners yet.</li>}
            {winners.map((w) => (
              <li key={w.awardId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span><strong>{w.name}</strong> · {w.competition} · {w.distance}{w.prize ? ` · ${w.prize}` : ""}</span>
                <span className="flex gap-3"><a className="text-green underline" target="_blank" href={`/api/og/winner/${w.awardId}?format=square`}>Square</a><a className="text-green underline" target="_blank" href={`/api/og/winner/${w.awardId}?format=story`}>Story</a></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
