import { redirect } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Alert } from "@/components/ui";
import { DRAFT_BANNER, DRAFT_RULES_MD } from "@/lib/legal-drafts";
import { getFeaturedCompetition } from "@/server/competitions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const c = await getFeaturedCompetition();
  if (c) redirect(`/competitions/${c.slug}`);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Alert tone="warn" title="Draft rules">{DRAFT_BANNER}</Alert>
      <Markdown source={DRAFT_RULES_MD} />
    </div>
  );
}
