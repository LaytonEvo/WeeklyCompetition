import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Eyebrow, buttonClass } from "./ui";

export function FittingPromo({ url, business, context, competitionId }: { url: string; business: string; context: string; competitionId?: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="grid overflow-hidden rounded-[28px] bg-cream ring-1 ring-line md:grid-cols-[1.2fr_1fr]">
        <div className="p-8 sm:p-12">
          <Eyebrow>{business} Fitting Studio</Eyebrow>
          <h2 className="mt-3 font-display text-4xl font-bold uppercase leading-none text-pine sm:text-5xl">Find clubs built for your swing</h2>
          <p className="mt-4 max-w-lg text-ink-soft">
            Our professional fitters use launch-monitor data to match head, shaft, loft and lie to the way you actually swing. A fitting is a separate appointment from Pin Hunters — book it on its own, any time.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {url ? (
              <a href={`/go/fitting?src=${context}${competitionId ? `&c=${competitionId}` : ""}`} className={buttonClass("primary", "lg")}>
                Book a club fitting <ArrowRight className="size-4" />
              </a>
            ) : (
              <Link href="/fitting" className={buttonClass("primary", "lg")}>About club fitting</Link>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">Fitting bookings are not competition entries.</p>
        </div>
        <div className="relative hidden min-h-64 bg-pine md:block" aria-hidden>
          <div className="absolute inset-0 opacity-90" style={{ background: "radial-gradient(500px 300px at 70% 30%, rgba(178,137,63,0.35), transparent 60%), repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 26px)" }} />
          <svg viewBox="0 0 200 200" className="absolute bottom-8 right-8 size-48 text-white/80">
            <g fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="100" cy="100" r="80" opacity="0.25" />
              <circle cx="100" cy="100" r="55" opacity="0.4" />
              <circle cx="100" cy="100" r="30" opacity="0.6" />
              <path d="M100 20v160M20 100h160" opacity="0.25" />
            </g>
            <circle cx="112" cy="88" r="5" fill="#b2893f" />
          </svg>
        </div>
      </div>
    </section>
  );
}
