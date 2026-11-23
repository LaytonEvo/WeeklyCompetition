import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { settings } from "@/db/schema";

/**
 * Business-editable settings. Secrets (API keys) are NOT stored here — they
 * live in environment variables / the hosting platform's secret manager.
 */
export const appSettingsSchema = z.object({
  brand: z.object({
    businessName: z.string().min(1),
    competitionName: z.string().min(1),
    tagline: z.string(),
    logoUrl: z.string(),
    colors: z.object({
      darkGreen: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      green: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      gold: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      cream: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
  }),
  store: z.object({
    addressLines: z.string(),
    postcode: z.string(),
    phone: z.string(),
    email: z.string(),
    openingHoursText: z.string(),
    mapUrl: z.string(),
  }),
  links: z.object({
    fittingBookingUrl: z.string(),
    shopUrl: z.string(),
    instagramUrl: z.string(),
    facebookUrl: z.string(),
  }),
  locale: z.object({
    currency: z.literal("GBP"),
    timezone: z.string(),
  }),
  booking: z.object({
    holdMinutes: z.number().int().min(2).max(60),
    bookingHorizonDays: z.number().int().min(1).max(60),
    minNoticeMinutes: z.number().int().min(0).max(1440),
    maxRoundsPerBooking: z.number().int().min(1).max(10),
    lateArrivalGraceMinutes: z.number().int().min(0).max(60),
    reminderHoursBefore: z.number().int().min(1).max(72),
    noShowPolicy: z.string(),
    refundPolicy: z.string(),
  }),
  leaderboard: z.object({
    showRoundsCount: z.boolean(),
    tvRotateSeconds: z.number().int().min(5).max(120),
    publicTopN: z.number().int().min(5).max(500),
    showPendingHoleInOnes: z.boolean(),
  }),
  sharing: z.object({
    enabled: z.boolean(),
    hashtag: z.string(),
  }),
  privacy: z.object({
    privacyNoticeVersion: z.string(),
    marketingNoticeVersion: z.string(),
    retentionMonthsInactive: z.number().int().min(6).max(120),
    evidenceRetentionMonths: z.number().int().min(1).max(120),
    minimumAge: z.number().int().min(0).max(99),
  }),
  attribution: z.object({
    fittingWindowDays: z.number().int().min(1).max(365),
  }),
  legalTexts: z.object({
    termsMarkdown: z.string(),
    privacyMarkdown: z.string(),
    termsVersion: z.string(),
  }),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  brand: {
    businessName: "Evolution Golf",
    competitionName: "Pin Hunters",
    tagline: "Five shots. One leaderboard. One weekly winner.",
    logoUrl: "",
    colors: { darkGreen: "#003D27", green: "#006747", gold: "#B2893F", cream: "#FAF7F1" },
  },
  store: {
    addressLines: "Ringwood, Hampshire",
    postcode: "",
    phone: "",
    email: "",
    openingHoursText: "See store opening hours",
    mapUrl: "",
  },
  links: { fittingBookingUrl: "", shopUrl: "", instagramUrl: "", facebookUrl: "" },
  locale: { currency: "GBP", timezone: "Europe/London" },
  booking: {
    holdMinutes: 10,
    bookingHorizonDays: 14,
    minNoticeMinutes: 15,
    maxRoundsPerBooking: 3,
    lateArrivalGraceMinutes: 10,
    reminderHoursBefore: 24,
    noShowPolicy:
      "If you arrive more than 10 minutes late your slot may be released. We will try to fit you in later the same day; otherwise your entry can be moved to another session in the same competition.",
    refundPolicy:
      "Unused entries can be refunded or moved to another session up to 2 hours before your booking. Completed rounds are not refundable. [DRAFT — business to confirm]",
  },
  leaderboard: { showRoundsCount: true, tvRotateSeconds: 15, publicTopN: 100, showPendingHoleInOnes: false },
  sharing: { enabled: true, hashtag: "#PinHunters" },
  privacy: {
    privacyNoticeVersion: "privacy-draft-1",
    marketingNoticeVersion: "marketing-draft-1",
    retentionMonthsInactive: 24,
    evidenceRetentionMonths: 12,
    minimumAge: 18,
  },
  attribution: { fittingWindowDays: 90 },
  legalTexts: {
    termsVersion: "draft-1",
    termsMarkdown: "",
    privacyMarkdown: "",
  },
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(tx: DbOrTx = db): Promise<AppSettings> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, "app"));
  const merged = deepMerge(DEFAULT_SETTINGS, row?.value ?? {});
  const parsed = appSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(value: AppSettings, userId: string, tx: DbOrTx = db) {
  const parsed = appSettingsSchema.parse(value);
  await tx
    .insert(settings)
    .values({ key: "app", value: parsed, updatedByUserId: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedByUserId: userId, updatedAt: new Date() } });
  return parsed;
}
