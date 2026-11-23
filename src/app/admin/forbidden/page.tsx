import { LinkButton } from "@/components/ui";

export const metadata = { title: "Not permitted", robots: { index: false } };

export default function Forbidden() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <h1 className="font-display text-4xl font-bold uppercase text-pine">Not permitted</h1>
      <p className="mt-2 max-w-sm text-muted">Your role doesn&apos;t include access to that page. Ask a Super Admin if you need it.</p>
      <LinkButton href="/admin" className="mt-6">Back to dashboard</LinkButton>
    </div>
  );
}
