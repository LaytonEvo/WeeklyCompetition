/**
 * Create (or reset the password of) a staff user. Used to bootstrap the first
 * Super Admin in production:
 *   pnpm admin:create --email owner@evolutiongolf.co.uk --name "Owner Name" --role super_admin
 * The password is read from the ADMIN_PASSWORD env var or prompted for.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db, getPool } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/crypto";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name") ?? "Administrator";
  const role = (arg("role") ?? "super_admin") as "super_admin" | "manager" | "staff" | "marketing";
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("--email is required");
  if (!["super_admin", "manager", "staff", "marketing"].includes(role)) throw new Error("Invalid --role");
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (min 12 chars): ");
    rl.close();
  }
  if (!password || password.length < 12) throw new Error("Password must be at least 12 characters");
  const hash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    await db.update(users).set({ passwordHash: hash, role, name, active: true }).where(eq(users.id, existing.id));
    await audit(db, { type: "system", label: "cli:create-admin" }, "user.password_reset", "user", existing.id, { after: { role } });
    console.log(`Updated ${email} (${role}).`);
  } else {
    const [u] = await db.insert(users).values({ email, name, role, passwordHash: hash }).returning();
    await audit(db, { type: "system", label: "cli:create-admin" }, "user.create", "user", u.id, { after: { role } });
    console.log(`Created ${email} (${role}).`);
  }
  await getPool().end();
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await getPool().end();
  process.exit(1);
});
