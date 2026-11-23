import type { DbOrTx } from "@/db";
import { auditLogs } from "@/db/schema";
import type { Role } from "./permissions";

export type Actor =
  | { type: "user"; id: string; label: string; role: Role }
  | { type: "customer"; id: string; label: string }
  | { type: "system"; id?: null; label: string };

export const SYSTEM_ACTOR: Actor = { type: "system", label: "system" };

/** Append-only audit record. Pass the transaction so the log commits atomically with the change. */
export async function audit(
  tx: DbOrTx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  data: { before?: unknown; after?: unknown; reason?: string | null; ip?: string | null } = {},
) {
  await tx.insert(auditLogs).values({
    actorType: actor.type,
    actorId: actor.type === "system" ? null : actor.id,
    actorLabel: actor.label,
    action,
    entityType,
    entityId,
    before: data.before === undefined ? null : JSON.parse(JSON.stringify(data.before)),
    after: data.after === undefined ? null : JSON.parse(JSON.stringify(data.after)),
    reason: data.reason ?? null,
    ip: data.ip ?? null,
  });
}
