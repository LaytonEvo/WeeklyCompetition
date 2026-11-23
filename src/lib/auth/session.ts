import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { customers, sessions, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { can, type Permission, type Role } from "@/lib/permissions";

export const STAFF_COOKIE = "ph_staff";
export const CUSTOMER_COOKIE = "ph_customer";
const STAFF_TTL_HOURS = 12;
const CUSTOMER_TTL_DAYS = 30;

export type StaffUser = { id: string; email: string; name: string; role: Role };
export type CustomerUser = { id: string; email: string; firstName: string; lastName: string };

async function requestMeta() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    userAgent: h.get("user-agent"),
  };
}

export async function startSession(subjectType: "user" | "customer", subjectId: string) {
  const token = randomToken(32);
  const ttlMs = subjectType === "user" ? STAFF_TTL_HOURS * 3600_000 : CUSTOMER_TTL_DAYS * 86400_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const meta = await requestMeta();
  await db.insert(sessions).values({ tokenHash: sha256(token), subjectType, subjectId, expiresAt, ...meta });
  const jar = await cookies();
  jar.set(subjectType === "user" ? STAFF_COOKIE : CUSTOMER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(subjectType: "user" | "customer") {
  const jar = await cookies();
  const name = subjectType === "user" ? STAFF_COOKIE : CUSTOMER_COOKIE;
  const token = jar.get(name)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(name);
}

async function lookup(subjectType: "user" | "customer", token: string | undefined) {
  if (!token) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), eq(sessions.subjectType, subjectType), gt(sessions.expiresAt, new Date())));
  return s ?? null;
}

/** Current staff user for this request (memoised per request). */
export const getStaff = cache(async (): Promise<StaffUser | null> => {
  const jar = await cookies();
  const s = await lookup("user", jar.get(STAFF_COOKIE)?.value);
  if (!s) return null;
  const [u] = await db.select().from(users).where(eq(users.id, s.subjectId));
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
});

export const getCustomer = cache(async (): Promise<CustomerUser | null> => {
  const jar = await cookies();
  const s = await lookup("customer", jar.get(CUSTOMER_COOKIE)?.value);
  if (!s) return null;
  const [c] = await db.select().from(customers).where(eq(customers.id, s.subjectId));
  if (!c || c.anonymisedAt || c.mergedIntoId) return null;
  return { id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName };
});

export function staffActor(u: StaffUser): Actor {
  return { type: "user", id: u.id, label: `${u.name} <${u.email}>`, role: u.role };
}

/** For server actions: throws if not signed in or lacking permission. */
export async function requireStaffAction(permission: Permission): Promise<{ user: StaffUser; actor: Actor }> {
  const user = await getStaff();
  if (!user) throw new AuthError();
  if (!can(user.role, permission)) throw new ForbiddenError();
  return { user, actor: staffActor(user) };
}

/** For admin pages: redirects to login / forbidden page. */
export async function requireStaffPage(permission: Permission = "dashboard.view"): Promise<StaffUser> {
  const user = await getStaff();
  if (!user) redirect("/admin/login");
  if (!can(user.role, permission)) redirect("/admin/forbidden");
  return user;
}

export async function requireCustomerPage(): Promise<CustomerUser> {
  const c = await getCustomer();
  if (!c) redirect("/login?next=/account");
  return c;
}
