import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  CRON_SECRET: z.string().min(8).optional(),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_LIVE_MODE_ALLOWED: z.string().optional().default("false"),
  EMAIL_PROVIDER: z.enum(["log", "resend", "postmark"]).default("log"),
  EMAIL_FROM: z.string().default("Pin Hunters <pinhunters@example.com>"),
  RESEND_API_KEY: z.string().optional().default(""),
  POSTMARK_SERVER_TOKEN: z.string().optional().default(""),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("eu-west-2"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  DEV_SHOW_MAGIC_LINKS: z.string().optional().default("false"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated server environment. Throws with a readable message on misconfiguration. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.DEV_SHOW_MAGIC_LINKS === "true") {
    throw new Error("DEV_SHOW_MAGIC_LINKS must not be enabled in production");
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
export const showDevMagicLinks = () => env().DEV_SHOW_MAGIC_LINKS === "true" && !isProd();
export const stripeConfigured = () => env().STRIPE_SECRET_KEY.startsWith("sk_");
export const stripeIsTestMode = () => env().STRIPE_SECRET_KEY.startsWith("sk_test_");
