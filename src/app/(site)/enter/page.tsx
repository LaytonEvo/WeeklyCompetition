import { Store } from "lucide-react";
import { BookingFlow } from "@/components/booking-flow";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { getBookableCompetitions } from "@/server/competitions";
import { publicCompetitionView } from "@/server/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enter the challenge" };

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c: slug } = await searchParams;
  const s = await getSettings();
  const comps = await getBookableCompetitions();
  const views = await Promise.all(comps.map(async (c) => ({ c, v: await publicCompetitionView(c) })));
  const bookable = views.filter((x) => x.v.canEnterOnline);
  const inStoreOnly = views.find((x) => x.v.approved && !x.v.canEnterOnline);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow={s.brand.competitionName} title="Enter the challenge" description="Choose a simulator session, tell us who you are, and we'll see you in store." />
      {bookable.length === 0 ? (
        <EmptyState
          title={inStoreOnly ? "Enter in store" : "Online entries aren't open right now"}
          icon={<Store className="size-8" />}
          action={<LinkButton href="/leaderboard" variant="secondary">View the leaderboard</LinkButton>}
        >
          {inStoreOnly
            ? "Online booking isn't available for this competition yet, but you can enter at the counter when the simulator is free."
            : "The next Pin Hunters competition hasn't opened for entries yet. Check back soon."}
        </EmptyState>
      ) : (
        <BookingFlow
          competitions={bookable.map(({ c, v }) => ({ id: c.id, slug: c.slug, name: c.name, entryFee: v.entryFee, entryFeePence: c.entryFeePence, entryMode: c.entryMode, shotsPerRound: c.shotsPerRound, holeName: c.holeName }))}
          initialSlug={slug}
          maxRounds={Math.min(s.booking.maxRoundsPerBooking, ...bookable.map(({ c }) => c.maxRoundsPerCustomer ?? 99))}
          termsVersion={bookable[0].c.termsVersion}
          minAge={s.privacy.minimumAge}
          refundPolicy={s.booking.refundPolicy}
        />
      )}
    </div>
  );
}
