import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { customers, notifications } from "@/db/schema";
import { emailProvider } from "@/lib/email/provider";
import { renderEmail, type EmailContent } from "@/lib/email/templates";
import { getSettings } from "@/lib/settings";

export interface QueueInput {
  type: string;
  customerId: string | null;
  to: string;
  content: EmailContent;
  dedupeKey: string;
  category?: "transactional" | "marketing";
}

/**
 * Queue an email exactly once per dedupe key (retries and duplicate webhooks
 * become no-ops). Returns the notification id, or null if it already existed.
 */
export async function queueEmail(input: QueueInput, tx: DbOrTx = db): Promise<string | null> {
  const s = await getSettings(tx);
  const rendered = renderEmail(input.content, s);
  const [row] = await tx
    .insert(notifications)
    .values({
      customerId: input.customerId,
      type: input.type,
      category: input.category ?? "transactional",
      toEmail: input.to,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  return row?.id ?? null;
}

const MAX_ATTEMPTS = 5;

/** Send one queued notification. Marketing mail is re-checked against current consent at send time. */
export async function deliver(id: string) {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!n || n.status === "sent" || n.status === "skipped") return n;
  if (n.category === "marketing") {
    const [c] = n.customerId ? await db.select().from(customers).where(eq(customers.id, n.customerId)) : [];
    if (!c || !c.marketingEmailConsent || c.anonymisedAt) {
      await db.update(notifications).set({ status: "skipped", error: "No current marketing consent" }).where(eq(notifications.id, id));
      return n;
    }
  }
  const provider = emailProvider();
  try {
    const res = await provider.send({ to: n.toEmail, subject: n.subject, html: n.bodyHtml, text: n.bodyText, idempotencyKey: n.dedupeKey, category: n.category as "transactional" | "marketing" });
    await db
      .update(notifications)
      .set({ status: "sent", provider: provider.name, providerMessageId: res.id, sentAt: new Date(), attempts: n.attempts + 1, error: null })
      .where(eq(notifications.id, id));
  } catch (e) {
    await db
      .update(notifications)
      .set({ status: "failed", provider: provider.name, attempts: n.attempts + 1, error: String((e as Error).message).slice(0, 500) })
      .where(eq(notifications.id, id));
  }
  return n;
}

/** Queue then attempt immediate delivery (best effort; the cron retries failures). */
export async function sendEmail(input: QueueInput) {
  const id = await queueEmail(input);
  if (id) await deliver(id);
  return id;
}

/** Retry queued/failed messages. Safe to run concurrently with itself? It may double-attempt; provider idempotency keys cover that. */
export async function deliverPending(limit = 50) {
  const pending = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(inArray(notifications.status, ["queued", "failed"]), lt(notifications.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  for (const p of pending) await deliver(p.id);
  return pending.length;
}
