import { desc } from "drizzle-orm";
import { db } from "@/db";
import { jackpotFunding, locations, simulators } from "@/db/schema";
import { formatPence } from "@/lib/money";
import { formatLocal } from "@/lib/time";

export async function formOptions() {
  const [locs, sims, funds] = await Promise.all([
    db.select().from(locations),
    db.select().from(simulators),
    db.select().from(jackpotFunding).orderBy(desc(jackpotFunding.createdAt)),
  ]);
  return {
    locations: locs.map((l) => ({ id: l.id, name: l.name })),
    simulators: sims.map((s) => ({ id: s.id, name: s.name, locationId: s.locationId })),
    funding: funds.map((f) => ({
      id: f.id,
      label: `${f.provider} — limit ${formatPence(f.coverageLimitPence, { compact: true })}, ${formatLocal(f.validFrom, "d LLL yy")}–${formatLocal(f.validTo, "d LLL yy")}${f.simulatorCoverageConfirmed ? "" : " (simulator cover NOT confirmed)"}`,
    })),
  };
}
