import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, magicLinks, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { normaliseEmail } from "./customers";
import { sendMagicLink } from "./messages";

const MAGIC_TTL_MIN = 20;

/**
 * Request a customer sign-in link. Always behaves the same whether or not the
 * email exists (no account enumeration). Returns the URL only so development
 * mode can display it.
 */
export async function requestMagicLink(emailRaw: string, ip: string | null, redirectTo = "/account") {
  const email = normaliseEmail(emailRaw);
  await rateLimit(`magic:${email}`, 5, 15 * 60);
  if (ip) await rateLimit(`magic-ip:${ip}`, 20, 15 * 60);
  const [c] = await db.select().from(customers).where(and(eq(customers.email, email), isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));
  if (!c) return { url: null };
  const token = randomToken(32);
  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/account";
  await db.insert(magicLinks).values({ email, tokenHash: sha256(token), redirectTo: safeRedirect, expiresAt: new Date(Date.now() + MAGIC_TTL_MIN * 60_000) });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/auth/verify?token=${token}`;
  await sendMagicLink(email, url, c.id, sha256(token).slice(0, 24));
  return { url };
}

/** Consume a magic link (single use). Returns the customer id or null. */
export async function consumeMagicLink(token: string) {
  const hash = sha256(token);
  return db.transaction(async (tx) => {
    const [link] = await tx
      .update(magicLinks)
      .set({ usedAt: new Date() })
      .where(and(eq(magicLinks.tokenHash, hash), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, new Date())))
      .returning();
    if (!link) return null;
    const [c] = await tx.select().from(customers).where(and(eq(customers.email, link.email), isNull(customers.mergedIntoId), isNull(customers.anonymisedAt)));
    if (!c) return null;
    await audit(tx, { type: "customer", id: c.id, label: c.email }, "auth.magic_link_login", "customer", c.id);
    return { customerId: c.id, redirectTo: link.redirectTo ?? "/account" };
  });
}

export async function verifyStaffLogin(emailRaw: string, password: string, ip: string | null) {
  const email = normaliseEmail(emailRaw);
  await rateLimit(`staff-login:${email}`, 8, 15 * 60);
  if (ip) await rateLimit(`staff-login-ip:${ip}`, 30, 15 * 60);
  const [u] = await db.select().from(users).where(eq(users.email, email));
  // Always run the hash to keep timing similar for unknown users.
  const ok = await verifyPassword(password, u?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
  if (!u || !u.active || !ok) return null;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await audit(db, { type: "user", id: u.id, label: u.email, role: u.role }, "auth.staff_login", "user", u.id, { ip });
  return u;
}
