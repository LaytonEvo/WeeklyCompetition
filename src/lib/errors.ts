/** Errors that are safe to show to the user. Anything else is logged and shown generically. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "app_error",
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export class AuthError extends AppError {
  constructor(message = "You need to sign in to do that.") {
    super(message, "unauthenticated", 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message, "forbidden", 403);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, "not_found", 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict", 409);
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

export function toActionError(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return {
      ok: false,
      error: issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "),
    };
  }
  // Next.js navigation (redirect/notFound) must propagate
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  console.error("[unexpected]", e);
  return { ok: false, error: "Something went wrong. Please try again or contact a manager." };
}
