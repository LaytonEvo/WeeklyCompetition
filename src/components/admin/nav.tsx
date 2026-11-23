"use client";

import {
  BarChart3, CalendarClock, CalendarDays, ClipboardList, CreditCard, Gauge, Megaphone, Menu, ScrollText, Settings, Sparkles, Target, Trophy, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "../ui";

const ICONS = { Gauge, Target, Trophy, CalendarDays, CalendarClock, Users, ClipboardList, Sparkles, CreditCard, BarChart3, Megaphone, Settings, ScrollText };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export function AdminNav({ items, footer }: { items: NavItem[]; footer: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const list = (
    <nav className="flex flex-col gap-0.5" aria-label="Admin">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white")}>
            <Icon className="size-[18px]" />
            <span className="flex-1">{i.label}</span>
            {i.badge ? <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-white">{i.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <button className="fixed left-3 top-3 z-50 rounded-full bg-pine p-2.5 text-white shadow lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-pine p-4 text-white transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-6 mt-12 px-2 lg:mt-2">
          <div className="font-display text-xl font-extrabold uppercase tracking-wider">Pin Hunters</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold">Operations</div>
        </div>
        <div className="flex-1 overflow-y-auto">{list}</div>
        <div className="border-t border-white/10 pt-4">{footer}</div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
