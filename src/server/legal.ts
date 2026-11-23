import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { legalApprovals } from "@/db/schema";
import { audit, type Actor } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";

export type LegalScope = "paid_entry" | "free_promotion";

/**
 * The launch gate. Paid entry, payment collection and public cash-prize claims
 * stay disabled unless an un-revoked approval for the scope covers the
 * competition's terms version. This system does NOT make any determination
 * about legality — it records the operator's confirmation that independent
 * legal review took place.
 */
export async function activeApproval(scope: LegalScope, termsVersion: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select()
    .from(legalApprovals)
    .where(and(eq(legalApprovals.scope, scope), eq(legalApprovals.termsVersion, termsVersion), isNull(legalApprovals.revokedAt)))
    .orderBy(desc(legalApprovals.approvedAt))
    .limit(1);
  return row ?? null;
}

export function scopeForMode(mode: "paid" | "free"): LegalScope {
  return mode === "paid" ? "paid_entry" : "free_promotion";
}

export async function isLaunchApproved(c: { entryMode: "paid" | "free"; termsVersion: string }, tx: DbOrTx = db) {
  return (await activeApproval(scopeForMode(c.entryMode), c.termsVersion, tx)) !== null;
}

export async function recordApproval(
  input: { scope: LegalScope; termsVersion: string; reviewerName: string; reviewerOrganisation?: string; notes?: string },
  actor: Actor & { type: "user" },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(legalApprovals)
      .values({ ...input, recordedByUserId: actor.id })
      .returning();
    await audit(tx, actor, "legal.approve", "legal_approval", row.id, { after: input });
    return row;
  });
}

export async function revokeApproval(id: string, reason: string, actor: Actor & { type: "user" }) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(legalApprovals)
      .set({ revokedAt: new Date(), revokedByUserId: actor.id, revokeReason: reason })
      .where(and(eq(legalApprovals.id, id), isNull(legalApprovals.revokedAt)))
      .returning();
    if (!row) throw new NotFoundError("Active approval");
    await audit(tx, actor, "legal.revoke", "legal_approval", id, { reason });
    return row;
  });
}

export async function listApprovals() {
  return db.select().from(legalApprovals).orderBy(desc(legalApprovals.approvedAt));
}
