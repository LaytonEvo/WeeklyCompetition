"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** While Stripe's webhook confirms payment, poll status and refresh when settled. */
export function BookingStatusPoller({ code }: { code: string }) {
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const t = setInterval(async () => {
      setWaited((w) => w + 2);
      const r = await fetch(`/api/booking-status/${code}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const s = (await r.json()) as { booking: string; payment: string | null };
      if (s.booking !== "held" || (s.payment && s.payment !== "pending")) {
        clearInterval(t);
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [code, router]);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-cream p-4 text-sm text-ink-soft ring-1 ring-line" role="status">
      <Loader2 className="size-5 animate-spin text-green" />
      {waited < 30 ? "Confirming your payment with Stripe…" : "This is taking longer than usual. You'll receive an email as soon as your payment is confirmed — you can safely close this page."}
    </div>
  );
}
