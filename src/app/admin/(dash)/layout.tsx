import { and, eq, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { staffLogout } from "@/app/admin/actions/auth";
import { AdminNav, type NavItem } from "@/components/admin/nav";
import { SubmitButton } from "@/components/form";
import { db } from "@/db";
import { hioClaims, legalApprovals } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { stripeConfigured, stripeIsTestMode } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Pin Hunters Admin" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage("dashboard.view");
  const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(hioClaims).where(eq(hioClaims.status, "pending_review"));
  const [{ approvals }] = await db.select({ approvals: sql<number>`count(*)::int` }).from(legalApprovals).where(and(sql`${legalApprovals.revokedAt} is null`, eq(legalApprovals.scope, "paid_entry")));
  const all: (NavItem & { perm: Permission })[] = [
    { href: "/admin", label: "Overview", icon: "Gauge", perm: "dashboard.view" },
    { href: "/admin/live", label: "Live rounds", icon: "Target", perm: "round.operate" },
    { href: "/admin/competitions", label: "Competitions", icon: "Trophy", perm: "competition.view" },
    { href: "/admin/availability", label: "Simulator availability", icon: "CalendarClock", perm: "availability.manage" },
    { href: "/admin/bookings", label: "Bookings", icon: "CalendarDays", perm: "booking.view" },
    { href: "/admin/customers", label: "Customers", icon: "Users", perm: "customer.view" },
    { href: "/admin/entries", label: "Entries", icon: "ClipboardList", perm: "booking.view" },
    { href: "/admin/hole-in-one", label: "Hole-in-one claims", icon: "Sparkles", perm: "hio.review", badge: pending },
    { href: "/admin/winners", label: "Winners & prizes", icon: "Trophy", perm: "prize.manage" },
    { href: "/admin/payments", label: "Payments", icon: "CreditCard", perm: "payment.view" },
    { href: "/admin/reports", label: "Reports", icon: "BarChart3", perm: "reports.view" },
    { href: "/admin/marketing", label: "Marketing", icon: "Megaphone", perm: "marketing.view" },
    { href: "/admin/settings", label: "Settings", icon: "Settings", perm: "settings.manage" },
    { href: "/admin/audit", label: "Audit log", icon: "ScrollText", perm: "audit.view" },
  ];
  const items = all.filter((i) => can(user.role, i.perm)).map(({ href, label, icon, badge }) => ({ href, label, icon, badge }));
  const mode = !stripeConfigured() ? "Stripe not configured" : stripeIsTestMode() ? "Stripe TEST mode" : "Stripe LIVE";

  return (
    <div className="min-h-dvh bg-[#f6f6f3]">
      <AdminNav
        items={items}
        footer={
          <div className="space-y-3 px-2 text-sm">
            <div>
              <div className="font-semibold">{user.name}</div>
              <div className="text-xs text-white/60">{ROLE_LABELS[user.role]}</div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 ${approvals ? "bg-white/10" : "bg-gold/30 text-white"}`}>{approvals ? "Paid entry approved" : "Paid entry locked"}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5">{mode}</span>
            </div>
            <a href="/" target="_blank" className="flex items-center gap-1.5 text-white/70 hover:text-white"><ExternalLink className="size-3.5" /> Public site</a>
            <a href="/tv" target="_blank" className="flex items-center gap-1.5 text-white/70 hover:text-white"><ExternalLink className="size-3.5" /> Shop TV screen</a>
            <form action={staffLogout}>
              <SubmitButton variant="light" size="sm" className="w-full" pendingText="Signing out…">Sign out</SubmitButton>
            </form>
          </div>
        }
      />
      <div className="lg:pl-64">{children}</div>
    </div>
  );
}
