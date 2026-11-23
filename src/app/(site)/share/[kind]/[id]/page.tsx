import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareButtons } from "@/components/share-buttons";
import { LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const KINDS = { result: "My Pin Hunters result", winner: "Pin Hunters winner", hio: "Pin Hunters hole-in-one" } as const;
type Kind = keyof typeof KINDS;

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }): Promise<Metadata> {
  const { kind, id } = await params;
  if (!(kind in KINDS)) return {};
  const img = `/api/og/${kind}/${id}?format=square`;
  return {
    title: KINDS[kind as Kind],
    description: "Evolution Golf's weekly closest-to-the-pin challenge.",
    openGraph: { images: [{ url: img, width: 1080, height: 1080 }] },
    twitter: { card: "summary_large_image", images: [img] },
  };
}

export default async function SharePage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ format?: string }> }) {
  const { kind, id } = await params;
  const { format } = await searchParams;
  if (!(kind in KINDS) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const f = format === "story" ? "story" : "square";
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const img = `/api/og/${kind}/${id}?format=${f}`;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Share" title={KINDS[kind as Kind]} actions={
        <div className="flex gap-2">
          <LinkButton href={`?format=square`} variant={f === "square" ? "primary" : "secondary"} size="sm">Square</LinkButton>
          <LinkButton href={`?format=story`} variant={f === "story" ? "primary" : "secondary"} size="sm">Story</LinkButton>
        </div>
      } />
      <div className="grid items-start gap-8 md:grid-cols-[1fr_280px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="Share card" className={`mx-auto w-full rounded-[var(--radius-card)] shadow-[var(--shadow-lift)] ring-1 ring-line ${f === "story" ? "max-w-sm" : "max-w-xl"}`} />
        <div>
          <ShareButtons imageUrl={img} pageUrl={`${base}/share/${kind}/${id}`} title={KINDS[kind as Kind]} filename={`pin-hunters-${kind}-${f}.png`} />
          <p className="mt-4 text-sm text-muted">Only your leaderboard display name and result are shown — never your contact details.</p>
        </div>
      </div>
    </div>
  );
}
