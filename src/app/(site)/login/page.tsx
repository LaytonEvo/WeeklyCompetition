import { LoginForm } from "@/components/login-form";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <PageHeader eyebrow="My Pin Hunters" title="Sign in" description="No password needed — we'll email you a secure one-time link." />
      <Card className="p-6">
        {sp.error && <p className="mb-4 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger">That sign-in link has expired or was already used. Request a new one below.</p>}
        <LoginForm next={sp.next ?? "/account"} />
      </Card>
      <p className="mt-6 text-center text-sm text-muted">Staff? <a href="/admin/login" className="font-medium text-green hover:underline">Staff sign-in</a></p>
    </div>
  );
}
