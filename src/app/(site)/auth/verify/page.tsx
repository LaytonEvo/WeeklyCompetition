import { redirect } from "next/navigation";
import { verifyLoginToken } from "@/app/actions/public";
import { SubmitButton } from "@/components/form";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false } };

/**
 * The link lands on a confirmation page and the token is only consumed on
 * POST. This stops email security scanners (which prefetch links) from
 * burning single-use tokens.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  async function confirm(form: FormData) {
    "use server";
    const t = String(form.get("token") ?? "");
    const to = t ? await verifyLoginToken(t) : null;
    redirect(to ?? "/login?error=expired");
  }
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <PageHeader eyebrow="My Pin Hunters" title="Confirm sign-in" />
      <Card className="p-6">
        <form action={confirm}>
          <input type="hidden" name="token" value={token ?? ""} />
          <p className="mb-5 text-sm text-ink-soft">Tap the button to finish signing in on this device.</p>
          <SubmitButton size="lg" className="w-full" pendingText="Signing in…">Continue to my account</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
