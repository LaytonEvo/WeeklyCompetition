/**
 * Distances are stored as integer millimetres. Staff enter metres (e.g. "1.34")
 * or centimetres; we parse with string arithmetic to avoid float error.
 */
export const MM_PER_METRE = 1000;
/** Sanity bound for a closest-to-the-pin result (200 m). */
export const MAX_DISTANCE_MM = 200_000;

export function parseMetresToMm(input: string): number | null {
  const s = input.trim().replace(/\s*m$/i, "");
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const mm = Number(w) * MM_PER_METRE + Number(f.padEnd(3, "0"));
  return mm <= MAX_DISTANCE_MM ? mm : null;
}

/** Standard display: metres with 2 decimals, e.g. 420 -> "0.42 m". */
export function formatMm(mm: number | null | undefined, decimals: 2 | 3 = 2): string {
  if (mm === null || mm === undefined) return "—";
  if (mm === 0) return decimals === 3 ? "0.000 m" : "0.00 m";
  // integer arithmetic for rounding (half-up) to avoid float artefacts
  const factor = decimals === 2 ? 10 : 1;
  const rounded = Math.round(mm / factor);
  const metres = Math.floor(rounded / (decimals === 2 ? 100 : 1000));
  const frac = String(rounded % (decimals === 2 ? 100 : 1000)).padStart(decimals, "0");
  return `${metres}.${frac} m`;
}

/**
 * For a ranked list, choose a display precision per row so that two
 * different underlying values never *look* tied. If a value collides with a
 * neighbour at 2dp but differs in millimetres, both are shown at 3dp.
 */
export function displayPrecisions(sortedMm: (number | null)[]): (2 | 3)[] {
  const out: (2 | 3)[] = sortedMm.map(() => 2);
  for (let i = 0; i < sortedMm.length - 1; i++) {
    const a = sortedMm[i];
    const b = sortedMm[i + 1];
    if (a === null || b === null || a === b) continue;
    if (formatMm(a, 2) === formatMm(b, 2)) {
      out[i] = 3;
      out[i + 1] = 3;
    }
  }
  return out;
}
