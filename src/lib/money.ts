/** Money is always integer pence. Never use floats for amounts. */
export function formatPence(pence: number, opts: { currency?: string; compact?: boolean } = {}): string {
  if (!Number.isInteger(pence)) throw new Error(`Money must be integer pence, received ${pence}`);
  const currency = opts.currency ?? "GBP";
  const whole = pence % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact && whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);
}

/** Parse a user-entered pounds string ("5", "5.00", "£1,000") into integer pence. */
export function parsePoundsToPence(input: string): number | null {
  const cleaned = input.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [w, f = ""] = cleaned.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}
