import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge-light request proxy:
 *  - captures first-touch campaign attribution (UTM / referral code / QR source)
 *    into a first-party cookie so it can be stored against the booking and
 *    customer record. This is a strictly necessary functional cookie scoped
 *    to entry attribution; no third-party tracking is used.
 */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const p = req.nextUrl.searchParams;
  const keys = ["utm_source", "utm_medium", "utm_campaign", "ref"] as const;
  if (keys.some((k) => p.get(k)) && !req.cookies.get("ph_attr")) {
    const value = Object.fromEntries(keys.map((k) => [k, (p.get(k) ?? "").slice(0, 100)]));
    res.cookies.set("ph_attr", JSON.stringify(value), { httpOnly: true, sameSite: "lax", maxAge: 30 * 86400, path: "/", secure: process.env.NODE_ENV === "production" });
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|tv|widget).*)"],
};
