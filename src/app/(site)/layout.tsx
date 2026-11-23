import Link from "next/link";
import { Menu } from "lucide-react";
import { LinkButton, Logo } from "@/components/ui";
import { getSettings } from "@/lib/settings";

const nav = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/winners", label: "Winners" },
  { href: "/hall-of-fame", label: "Hall of Fame" },
  { href: "/fitting", label: "Club Fitting" },
  { href: "/rules", label: "Rules" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Pin Hunters home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-green-50 hover:text-pine">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/account" className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink-soft hover:text-pine sm:block">
              My account
            </Link>
            <LinkButton href="/enter" size="md">
              Enter
            </LinkButton>
            <details className="group relative lg:hidden">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full ring-1 ring-line [&::-webkit-details-marker]:hidden" aria-label="Menu">
                <Menu className="size-5" />
              </summary>
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white p-2 shadow-[var(--shadow-lift)] ring-1 ring-line">
                {[...nav, { href: "/account", label: "My account" }].map((n) => (
                  <Link key={n.href} href={n.href} className="block rounded-xl px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-green-50">
                    {n.label}
                  </Link>
                ))}
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="mt-24 border-t border-line bg-cream">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-muted">
              {s.brand.tagline} A weekly closest-to-the-pin challenge on the simulator at {s.brand.businessName}, {s.store.addressLines}.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Competition</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="hover:text-pine" href="/leaderboard">Live leaderboard</Link></li>
              <li><Link className="hover:text-pine" href="/enter">Book a session</Link></li>
              <li><Link className="hover:text-pine" href="/rules">Rules</Link></li>
              <li><Link className="hover:text-pine" href="/winners">Past winners</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{s.brand.businessName}</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link className="hover:text-pine" href="/fitting">Professional club fitting</Link></li>
              <li><Link className="hover:text-pine" href="/terms">Terms</Link></li>
              <li><Link className="hover:text-pine" href="/privacy">Privacy notice</Link></li>
              {s.store.phone && <li className="text-muted">{s.store.phone}</li>}
            </ul>
          </div>
        </div>
        <div className="border-t border-line/80">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
            <span>© {new Date().getFullYear()} {s.brand.businessName}. {s.store.addressLines}{s.store.postcode ? `, ${s.store.postcode}` : ""}.</span>
            <span>Competition entry is subject to the published rules. 18+ unless stated otherwise.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
