"use client";

import { useActionState } from "react";
import { requestLogin } from "@/app/actions/public";
import { SubmitButton } from "./form";
import { Alert, Field, Input } from "./ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(requestLogin, null);
  return (
    <form action={action} className="space-y-4">
      {state && "error" in state && state.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.ok && <Alert tone="green">{state.message}</Alert>}
      {state && "devLink" in state && state.devLink && (
        <Alert tone="gold" title="Development mode">
          Email is in log mode. <a href={state.devLink} className="font-semibold underline">Open sign-in link</a>
        </Alert>
      )}
      <input type="hidden" name="next" value={next} />
      <Field label="Email address" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Sending…">Email me a sign-in link</SubmitButton>
    </form>
  );
}
