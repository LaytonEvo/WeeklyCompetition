/**
 * Role-based permission matrix. Every sensitive server action calls
 * `requirePermission()` — UI hiding is cosmetic only.
 */
export type Role = "super_admin" | "manager" | "staff" | "marketing";

export const PERMISSIONS = {
  "dashboard.view": ["super_admin", "manager", "staff", "marketing"],
  "competition.view": ["super_admin", "manager", "staff", "marketing"],
  "competition.manage": ["super_admin", "manager"],
  "competition.finalise": ["super_admin", "manager"],
  "availability.manage": ["super_admin", "manager"],
  "availability.override": ["super_admin", "manager"],
  "booking.view": ["super_admin", "manager", "staff"],
  "booking.manage": ["super_admin", "manager", "staff"],
  "customer.view": ["super_admin", "manager", "staff"],
  "customer.create": ["super_admin", "manager", "staff"],
  "customer.edit": ["super_admin", "manager"],
  "customer.export": ["super_admin", "manager"],
  "customer.merge": ["super_admin", "manager"],
  "customer.erase": ["super_admin"],
  "customer.notes": ["super_admin", "manager", "staff"],
  "round.operate": ["super_admin", "manager", "staff"],
  "round.correct_verified": ["super_admin", "manager"],
  "round.disqualify": ["super_admin", "manager"],
  "payment.record_instore": ["super_admin", "manager", "staff"],
  "payment.complimentary": ["super_admin", "manager"],
  "payment.view": ["super_admin", "manager"],
  "payment.refund": ["super_admin", "manager"],
  "hio.review": ["super_admin", "manager"],
  "prize.manage": ["super_admin", "manager"],
  "reports.view": ["super_admin", "manager", "marketing"],
  "reports.financial": ["super_admin", "manager"],
  "marketing.view": ["super_admin", "manager", "marketing"],
  "marketing.export_consented": ["super_admin", "manager", "marketing"],
  "settings.manage": ["super_admin"],
  "legal.approve": ["super_admin"],
  "funding.manage": ["super_admin"],
  "users.manage": ["super_admin"],
  "audit.view": ["super_admin", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  manager: "Manager",
  staff: "Staff",
  marketing: "Marketing",
};
