import { asc } from "drizzle-orm";
import { saveUserAction } from "@/app/admin/actions/ops";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, CardHeader, Checkbox, Input, PageHeader, Select } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireStaffPage } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff users" };

const roles = Object.entries(ROLE_LABELS);

export default async function UsersPage() {
  await requireStaffPage("users.manage");
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return (
    <div className="mx-auto max-w-4xl p-4 pt-16 sm:p-8 lg:pt-8">
      <PageHeader title="Staff users" description="Super Admin: everything. Manager: competitions, scores, winners, refunds, reports. Staff: counter operations. Marketing: reports and approved results only." />
      <Card className="mb-6">
        <ul className="divide-y divide-line">
          {rows.map((u) => (
            <li key={u.id} className="px-5 py-4">
              <ActionForm action={saveUserAction} className="grid items-center gap-3 space-y-0 sm:grid-cols-[1.2fr_1fr_1fr_auto_auto]">
                <input type="hidden" name="id" value={u.id} />
                <div><Input name="name" defaultValue={u.name} aria-label="Name" /><div className="mt-1 text-xs text-muted">{u.email} · last login {formatLocal(u.lastLoginAt, "d LLL HH:mm")}</div></div>
                <Select name="role" defaultValue={u.role} aria-label="Role">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                <Input name="password" type="password" placeholder="New password (optional)" aria-label="New password" autoComplete="new-password" />
                <Checkbox name="active" defaultChecked={u.active} label={u.active ? "Active" : <Badge tone="danger">Disabled</Badge>} />
                <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Add staff member" />
        <ActionForm action={saveUserAction} resetOnSuccess className="grid gap-3 p-5 sm:grid-cols-2">
          <Input name="name" placeholder="Name" aria-label="Name" />
          <Input name="email" type="email" placeholder="Email" aria-label="Email" />
          <Select name="role" defaultValue="staff" aria-label="Role">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input name="password" type="password" placeholder="Initial password (12+ characters)" aria-label="Password" autoComplete="new-password" />
          <div><SubmitButton>Add user</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
