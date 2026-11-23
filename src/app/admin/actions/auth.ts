"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth/session";
import { toActionError } from "@/lib/errors";
import { verifyStaffLogin } from "@/server/auth";

export async function staffLogin(_prev: unknown, form: FormData) {
  let ok = false;
  try {
    const email = z.string().email().parse(form.get("email"));
    const password = z.string().min(1).parse(form.get("password"));
    const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const user = await verifyStaffLogin(email, password, ip);
    if (!user) return { ok: false, error: "Email or password is incorrect." };
    await startSession("user", user.id);
    ok = true;
  } catch (e) {
    return toActionError(e);
  }
  if (ok) redirect(String(form.get("next") || "/admin"));
  return null;
}

export async function staffLogout() {
  await endSession("user");
  redirect("/admin/login");
}
