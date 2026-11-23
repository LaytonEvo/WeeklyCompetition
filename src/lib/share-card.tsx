import { ImageResponse } from "next/og";

export type CardFormat = "square" | "story";
export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

const PINE = "#003d27";
const GOLD = "#b2893f";

/**
 * Premium share card rendered to PNG. Contains only public display
 * information (display name, distance, rank, week) — no contact details.
 */
export function shareCard(opts: {
  format: CardFormat;
  variant: "result" | "winner" | "hio";
  kicker: string;
  name: string;
  headline: string;
  sub?: string;
  footer: string;
  brand: string;
}) {
  const { width, height } = CARD_SIZES[opts.format];
  const story = opts.format === "story";
  const dark = opts.variant !== "result";
  const bg = dark ? PINE : "#ffffff";
  const fg = dark ? "#ffffff" : PINE;
  return new ImageResponse(
    (
      <div style={{ width, height, display: "flex", flexDirection: "column", background: bg, color: fg, padding: story ? 110 : 90, position: "relative", fontFamily: "sans-serif" }}>
        {/* concentric target rings */}
        <div style={{ position: "absolute", right: -260, top: story ? 360 : -200, width: 900, height: 900, borderRadius: 900, border: `2px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,61,39,0.07)"}`, display: "flex" }} />
        <div style={{ position: "absolute", right: -110, top: story ? 510 : -50, width: 600, height: 600, borderRadius: 600, border: `2px solid ${dark ? "rgba(255,255,255,0.10)" : "rgba(0,61,39,0.08)"}`, display: "flex" }} />
        <div style={{ position: "absolute", right: 40, top: story ? 660 : 100, width: 300, height: 300, borderRadius: 300, border: `3px solid ${GOLD}`, opacity: 0.6, display: "flex" }} />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, letterSpacing: 10, color: GOLD, fontWeight: 700 }}>{opts.brand.toUpperCase()}</div>
          <div style={{ fontSize: story ? 150 : 128, fontWeight: 800, letterSpacing: 4, lineHeight: 0.9, marginTop: 12 }}>PIN HUNTERS</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ fontSize: 36, letterSpacing: 8, fontWeight: 700, color: dark ? GOLD : GOLD }}>{opts.kicker.toUpperCase()}</div>
          <div style={{ fontSize: story ? 110 : 96, fontWeight: 800, marginTop: 18, lineHeight: 1 }}>{opts.name.toUpperCase()}</div>
          <div style={{ fontSize: story ? 230 : 200, fontWeight: 800, marginTop: 10, lineHeight: 1, letterSpacing: -4, color: dark ? "#ffffff" : PINE }}>{opts.headline}</div>
          {opts.sub && (
            <div style={{ display: "flex", marginTop: 26 }}>
              <div style={{ fontSize: 44, fontWeight: 700, padding: "14px 30px", borderRadius: 999, background: dark ? GOLD : PINE, color: "#ffffff" }}>{opts.sub}</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: story ? 140 : 70, paddingTop: 34, borderTop: `2px solid ${dark ? "rgba(255,255,255,0.18)" : "rgba(0,61,39,0.12)"}`, fontSize: 30 }}>
          <div style={{ display: "flex", opacity: 0.85 }}>{opts.footer}</div>
          <div style={{ display: "flex", fontWeight: 700, color: GOLD, letterSpacing: 4 }}>{opts.brand.toUpperCase()}</div>
        </div>
      </div>
    ),
    { width, height, headers: { "Cache-Control": "public, max-age=300" } },
  );
}

export function parseFormat(v: string | null): CardFormat {
  return v === "story" ? "story" : "square";
}
