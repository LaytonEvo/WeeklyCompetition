"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass, cn } from "./ui";

export type FormState = { ok: boolean; error?: string; message?: string } | null;

export function SubmitButton({ children, pendingText, variant = "primary", size = "md", className, confirm, name, value }: {
  children: ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/**
 * Progressive-enhancement form bound to a server action returning FormState.
 * Shows success/error inline; resets on success when `resetOnSuccess`.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={cn("space-y-4", className)}>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.ok && state.message && <Alert tone="green">{state.message}</Alert>}
      {children}
    </form>
  );
}
