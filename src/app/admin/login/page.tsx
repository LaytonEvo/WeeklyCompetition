import { redirect } from "next/navigation";
import { StaffLoginForm } from "@/components/admin/staff-login-form";
import { Card, Logo } from "@/components/ui";
import { getStaff } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in", robots: { index: false } };

export default async function StaffLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getStaff()) redirect("/admin");
  const { next } = await searchParams;
  const safeNext = next?.startsWith("/admin") ? next : "/admin";
  return (
    <div className="bg-turf flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold">Staff sign-in</h1>
        <p className="mt-1 text-sm text-muted">For Evolution Golf team members only.</p>
        <div className="mt-6"><StaffLoginForm next={safeNext} /></div>
      </Card>
    </div>
  );
}
