import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...v: ClassValue[]) {
  return twMerge(clsx(v));
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold" | "light";
type Size = "sm" | "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  primary: "bg-pine text-white hover:bg-pine-900 shadow-sm",
  secondary: "bg-white text-ink ring-1 ring-inset ring-line hover:ring-ink/25 hover:bg-cream",
  ghost: "text-ink-soft hover:bg-green-50 hover:text-ink",
  danger: "bg-danger text-white hover:bg-danger/90",
  gold: "bg-gold text-white hover:brightness-95 shadow-sm",
  light: "bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/20",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  xl: "h-16 px-8 text-lg gap-3",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={p.type ?? "button"} className={buttonClass(variant, size, className)} {...p} />;
}

export function LinkButton({ variant, size, className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)] ring-1 ring-line/70", className)} {...p} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "green" | "gold" | "danger" | "warn" | "pine" | "blue";
const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  green: "bg-green-50 text-green ring-green/15",
  gold: "bg-gold-50 text-[#7d5f26] ring-gold/20",
  danger: "bg-danger-50 text-danger ring-danger/15",
  warn: "bg-warn-50 text-warn ring-warn/20",
  pine: "bg-pine text-white",
  blue: "bg-sky-50 text-sky-800 ring-sky-700/15",
};
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-transparent", tones[tone], className)}>{children}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "gold" | "green" }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cn("mt-2 font-display text-3xl font-bold tabular", tone === "gold" ? "text-gold" : tone === "green" ? "text-green" : "text-ink")}>{value}</div>
      {hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
    </Card>
  );
}

export function Label({ className, ...p }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...p} />;
}

const inputBase =
  "block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-[15px] text-ink shadow-sm ring-1 ring-inset ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-inset focus:ring-green focus:outline-none disabled:bg-zinc-50";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(inputBase, className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputBase, "min-h-24", className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cn(inputBase, "pr-8", className)} {...p} />;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="mt-1 text-sm text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, description, className, ...p }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl p-1", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line accent-[#003d27]" {...p} />
      <span className="text-sm leading-snug text-ink-soft">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Alert({ tone = "neutral", title, children, className }: { tone?: "neutral" | "danger" | "warn" | "green" | "gold"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const map = {
    neutral: "bg-zinc-50 ring-zinc-200 text-ink-soft",
    danger: "bg-danger-50 ring-danger/20 text-danger",
    warn: "bg-warn-50 ring-warn/25 text-[#6d3f06]",
    green: "bg-green-50 ring-green/20 text-pine",
    gold: "bg-gold-50 ring-gold/25 text-[#6b4f1d]",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-2xl px-4 py-3 text-sm ring-1 ring-inset", map[tone], className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title && "mt-0.5", "leading-relaxed")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line bg-cream/50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-green">{icon}</div>}
      <h3 className="font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, eyebrow, description, actions }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-gold">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ className, ...p }: ComponentProps<"table">) {
  return (
    <div className="-mx-px overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)} {...p} />
    </div>
  );
}
export function Th({ className, ...p }: ComponentProps<"th">) {
  return <th className={cn("whitespace-nowrap border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", className)} {...p} />;
}
export function Td({ className, ...p }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line/60 px-4 py-3 align-middle", className)} {...p} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-xs font-semibold uppercase tracking-[0.18em] text-gold", className)}>{children}</div>;
}

export function Logo({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <circle cx="16" cy="16" r="15" fill={light ? "rgba(255,255,255,0.1)" : "#003d27"} />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="#b2893f" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="4.5" fill="none" stroke={light ? "#fff" : "#fff"} strokeWidth="1.4" opacity="0.85" />
        <path d="M16 4v12" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 4.5l6 2.6-6 2.6z" fill="#b2893f" />
      </svg>
      <span className="leading-none">
        <span className={cn("block font-display text-[19px] font-extrabold uppercase tracking-[0.08em]", light ? "text-white" : "text-pine")}>Pin Hunters</span>
        <span className={cn("block text-[10px] font-semibold uppercase tracking-[0.28em]", light ? "text-gold" : "text-gold")}>Evolution Golf</span>
      </span>
    </span>
  );
}
