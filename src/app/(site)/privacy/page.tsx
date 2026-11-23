import { Markdown } from "@/components/markdown";
import { Alert } from "@/components/ui";
import { DRAFT_PRIVACY_MD } from "@/lib/legal-drafts";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy notice" };

export default async function PrivacyPage() {
  const s = await getSettings();
  const text = s.legalTexts.privacyMarkdown || DRAFT_PRIVACY_MD;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {/DRAFT/.test(text) && <Alert tone="warn" title="Draft">This privacy notice is a draft and must be reviewed by the business before launch.</Alert>}
      <Markdown source={text} />
      <p className="mt-8 text-xs text-muted">Notice version {s.privacy.privacyNoticeVersion}</p>
    </div>
  );
}
