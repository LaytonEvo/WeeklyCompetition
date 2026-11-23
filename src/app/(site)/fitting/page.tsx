import { FittingPromo } from "@/components/fitting-promo";
import { Card, PageHeader } from "@/components/ui";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Professional club fitting" };

export default async function FittingPage() {
  const s = await getSettings();
  const points = [
    ["Data, not guesswork", "Launch-monitor numbers on ball speed, launch, spin and dispersion show what actually changes when you change clubs."],
    ["Every brand on test", "Compare heads and shafts side by side to find the combination that suits your swing and budget."],
    ["Built for you", "Loft, lie, length, grip and shaft are specified around your measurements and your game."],
  ];
  return (
    <div className="py-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <PageHeader eyebrow={`${s.brand.businessName} Fitting Studio`} title="Professional club fitting" description="Playing Pin Hunters on our simulator? It's the same technology our fitters use every day. A fitting is a separate appointment — it isn't a competition entry." />
        <div className="grid gap-4 md:grid-cols-3">
          {points.map(([t, d]) => (
            <Card key={t} className="p-6">
              <h2 className="font-semibold text-ink">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
            </Card>
          ))}
        </div>
      </div>
      <div className="mt-12">
        <FittingPromo url={s.links.fittingBookingUrl} business={s.brand.businessName} context="fitting_page" />
      </div>
    </div>
  );
}
