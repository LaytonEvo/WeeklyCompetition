import Link from "next/link";
import { Badge, Card, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";
import { listCustomers } from "@/server/customer-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const user = await requireStaffPage("customer.view");
  const sp = await searchParams;
  const rows = await listCustomers({ q: sp.q, filter: sp.filter });
  const fullContact = can(user.role, "customer.edit");
  return (
    <div className="p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader
        title="Customers"
        description="One record per person across all competitions. Duplicates can be merged from a profile."
        actions={can(user.role, "customer.export") && <LinkButton variant="secondary" href={`/admin/export/customers?${new URLSearchParams({ q: sp.q ?? "", filter: sp.filter ?? "" })}`}>Export CSV</LinkButton>}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Search name, email or mobile" className="max-w-sm" aria-label="Search" />
        <Select name="filter" defaultValue={sp.filter ?? ""} className="max-w-56" aria-label="Filter">
          <option value="">All customers</option>
          <option value="marketing">Marketing opt-in</option>
          <option value="fitting">Fitting interest</option>
        </Select>
        <button className="rounded-full bg-pine px-4 text-sm font-semibold text-white">Search</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Contact</Th><Th>Rounds</Th><Th>Last round</Th><Th>Flags</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={5} className="py-10 text-center text-muted">No customers found.</Td></tr>}
            {rows.map(({ c, rounds, lastRound }) => (
              <tr key={c.id} className="hover:bg-cream/50">
                <Td><Link href={`/admin/customers/${c.id}`} className="font-semibold hover:text-pine">{c.firstName} {c.lastName}</Link></Td>
                <Td className="text-sm text-muted">{fullContact ? c.email : c.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}<div>{fullContact ? c.mobile : c.mobile ? `•••• ${c.mobile.slice(-4)}` : ""}</div></Td>
                <Td>{rounds}</Td>
                <Td className="text-sm">{lastRound ? formatLocal(new Date(lastRound), "d LLL yyyy") : "—"}</Td>
                <Td className="space-x-1">{c.marketingEmailConsent && <Badge tone="green">marketing</Badge>}{c.fittingInterest && <Badge tone="gold">fitting</Badge>}{c.anonymisedAt && <Badge>erased</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
