import { describe, expect, it } from "vitest";
import { competitionWindow, formatLocal, localToUtc } from "@/lib/time";
import { normaliseUkMobile, publicDisplayName } from "@/server/customers";
import { toCsv } from "@/server/reports";
import { can } from "@/lib/permissions";
import { sniffImageType } from "@/lib/storage";

describe("Europe/London timezone handling", () => {
  it("converts local wall time to UTC in GMT and BST", () => {
    expect(localToUtc("2026-01-15", "18:00").toISOString()).toBe("2026-01-15T18:00:00.000Z"); // GMT
    expect(localToUtc("2026-07-15", "18:00").toISOString()).toBe("2026-07-15T17:00:00.000Z"); // BST
  });
  it("keeps the local deadline across the spring-forward change (29 Mar 2026)", () => {
    // Monday 23 Mar 2026 09:00 GMT → Sunday 29 Mar 2026 18:00 BST
    const w = competitionWindow("2026-03-23", "09:00", 7, "18:00");
    expect(w.startsAt.toISOString()).toBe("2026-03-23T09:00:00.000Z");
    expect(w.endsAt.toISOString()).toBe("2026-03-29T17:00:00.000Z");
    expect(formatLocal(w.endsAt, "ccc HH:mm")).toBe("Sun 18:00");
  });
  it("keeps the local deadline across the autumn change (25 Oct 2026)", () => {
    const w = competitionWindow("2026-10-19", "09:00", 7, "18:00");
    expect(w.startsAt.toISOString()).toBe("2026-10-19T08:00:00.000Z"); // BST
    expect(w.endsAt.toISOString()).toBe("2026-10-25T18:00:00.000Z"); // GMT
    expect(formatLocal(w.endsAt, "ccc HH:mm")).toBe("Sun 18:00");
  });
});

describe("customer data helpers", () => {
  it("normalises UK mobiles to E.164", () => {
    expect(normaliseUkMobile("07700 900123")).toBe("+447700900123");
    expect(normaliseUkMobile("+44 7700 900123")).toBe("+447700900123");
    expect(normaliseUkMobile("0044 (0)7700900123".replace("(0)", ""))).toBe("+447700900123");
    expect(normaliseUkMobile("01425 123456")).toBeNull();
    expect(normaliseUkMobile("123")).toBeNull();
  });
  it("never exposes surnames publicly without consent", () => {
    const base = { id: "abcd1234-0000", firstName: "James", lastName: "Robinson", publicationConsent: false, anonymisedAt: null };
    expect(publicDisplayName({ ...base, displayNameStyle: "first_initial" })).toBe("James R.");
    expect(publicDisplayName({ ...base, displayNameStyle: "full" })).toBe("James R.");
    expect(publicDisplayName({ ...base, displayNameStyle: "full", publicationConsent: true })).toBe("James Robinson");
    expect(publicDisplayName({ ...base, displayNameStyle: "anonymous" })).toBe("Player ABCD");
    expect(publicDisplayName({ ...base, displayNameStyle: "initials" })).toBe("J.R.");
  });
  it("CSV export neutralises formula injection", () => {
    expect(toCsv([{ a: "=SUM(1)", b: 'x,"y"' }])).toBe(`a,b\n'=SUM(1),"x,""y"""`);
  });
});

describe("permissions", () => {
  it("restricts sensitive operations by role", () => {
    expect(can("staff", "round.operate")).toBe(true);
    expect(can("staff", "round.correct_verified")).toBe(false);
    expect(can("staff", "hio.review")).toBe(false);
    expect(can("staff", "payment.refund")).toBe(false);
    expect(can("marketing", "customer.view")).toBe(false);
    expect(can("marketing", "reports.view")).toBe(true);
    expect(can("manager", "legal.approve")).toBe(false);
    expect(can("super_admin", "legal.approve")).toBe(true);
    expect(can(null, "dashboard.view")).toBe(false);
  });
});

describe("upload validation", () => {
  it("detects image types by magic bytes", () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("<svg onload=alert(1)>      "))).toBeNull();
  });
});
