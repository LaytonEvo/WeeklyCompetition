import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

/** Returns a Stripe client, or null when Stripe isn't configured (payments then stay disabled). */
export function getStripe(): Stripe | null {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return null;
  if (key.startsWith("sk_live_") && env().STRIPE_LIVE_MODE_ALLOWED !== "true") {
    throw new Error("Live Stripe key configured but STRIPE_LIVE_MODE_ALLOWED is not 'true'. Refusing to take live payments.");
  }
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "pin-hunters" } });
  return client;
}

/** Signature verification only (no API key needed). */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}
