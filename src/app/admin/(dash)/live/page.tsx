import { LiveConsole } from "@/components/admin/live-console";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { consoleState } from "@/server/console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live rounds" };

export default async function LivePage() {
  const user = await requireStaffPage("round.operate");
  const state = await consoleState();
  return <LiveConsole initial={state} me={{ role: user.role, canComplimentary: can(user.role, "payment.complimentary"), canOverride: can(user.role, "availability.override") }} />;
}
