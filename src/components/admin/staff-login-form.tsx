"use client";

import { useActionState } from "react";
import { staffLogin } from "@/app/admin/actions/auth";
import { SubmitButton } from "../form";
import { Alert, Field, Input } from "../ui";

export function StaffLoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(staffLogin, null);
  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && "error" in state && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
