import { Markdown } from "@/components/markdown";
import { Alert } from "@/components/ui";
import { DRAFT_BANNER, DRAFT_TERMS_MD } from "@/lib/legal-drafts";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms" };

export default async function TermsPage() {
  const s = await getSettings();
  const text = s.legalTexts.termsMarkdown || DRAFT_TERMS_MD;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {/DRAFT/.test(text) && <Alert tone="warn" title="Draft">{DRAFT_BANNER}</Alert>}
      <Markdown source={text} />
      <h2 className="mt-8 text-xl font-semibold">No-show policy</h2>
      <p className="mt-2 text-ink-soft">{s.booking.noShowPolicy}</p>
      <h2 className="mt-6 text-xl font-semibold">Refund policy</h2>
      <p className="mt-2 text-ink-soft">{s.booking.refundPolicy}</p>
      <p className="mt-8 text-xs text-muted">Terms version {s.legalTexts.termsVersion}</p>
    </div>
  );
}
