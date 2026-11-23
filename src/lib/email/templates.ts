import type { AppSettings } from "@/lib/settings";

export function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Block =
  | { p: string }
  | { big: string; caption?: string }
  | { button: string; href: string }
  | { rows: [string, string][] }
  | { note: string }
  | { divider: true };

export interface EmailContent {
  subject: string;
  preheader?: string;
  heading: string;
  greeting?: string;
  blocks: Block[];
  /** Fitting CTA shown in a soft panel (transactional-appropriate cross-promotion). */
  fittingCta?: { href: string; text: string } | null;
  footerNote?: string;
}

export function renderEmail(content: EmailContent, s: AppSettings) {
  const c = s.brand.colors;
  const html: string[] = [];
  const text: string[] = [];
  if (content.greeting) {
    html.push(`<p style="margin:0 0 16px;font-size:16px;color:#1d2a24">${esc(content.greeting)}</p>`);
    text.push(content.greeting, "");
  }
  for (const b of content.blocks) {
    if ("p" in b) {
      html.push(`<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#33413a">${esc(b.p)}</p>`);
      text.push(b.p, "");
    } else if ("big" in b) {
      html.push(
        `<div style="margin:8px 0 24px;padding:24px;border-radius:14px;background:${c.cream};text-align:center"><div style="font-size:40px;font-weight:800;letter-spacing:-0.02em;color:${c.darkGreen};font-family:ui-monospace,Menlo,monospace">${esc(b.big)}</div>${b.caption ? `<div style="margin-top:6px;font-size:13px;color:#6b7a72;text-transform:uppercase;letter-spacing:0.12em">${esc(b.caption)}</div>` : ""}</div>`,
      );
      text.push(`>> ${b.big}${b.caption ? ` (${b.caption})` : ""}`, "");
    } else if ("button" in b) {
      html.push(
        `<p style="margin:8px 0 24px"><a href="${esc(b.href)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:${c.darkGreen};color:#fff;font-weight:600;text-decoration:none;font-size:15px">${esc(b.button)}</a></p>`,
      );
      text.push(`${b.button}: ${b.href}`, "");
    } else if ("rows" in b) {
      html.push(
        `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px">${b.rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#6b7a72;font-size:14px">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1d2a24;font-size:14px">${esc(v)}</td></tr>`,
          )
          .join("")}</table>`,
      );
      for (const [k, v] of b.rows) text.push(`${k}: ${v}`);
      text.push("");
    } else if ("note" in b) {
      html.push(`<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7a72">${esc(b.note)}</p>`);
      text.push(b.note, "");
    } else {
      html.push(`<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>`);
      text.push("—", "");
    }
  }
  if (content.fittingCta) {
    html.push(
      `<div style="margin:24px 0 0;padding:20px;border-radius:14px;border:1px solid ${c.gold}33;background:#fffdf8"><div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${c.gold};font-weight:700">${esc(s.brand.businessName)} Fitting Studio</div><p style="margin:8px 0 12px;font-size:15px;color:#33413a">${esc(content.fittingCta.text)}</p><a href="${esc(content.fittingCta.href)}" style="color:${c.green};font-weight:600">Book a professional club fitting →</a></div>`,
    );
    text.push(content.fittingCta.text, `Book a fitting: ${content.fittingCta.href}`, "");
  }
  const footer = `${s.brand.businessName} · ${s.store.addressLines}${s.store.postcode ? ", " + s.store.postcode : ""}`;
  const doc = `<!doctype html><html><body style="margin:0;background:#f4f2ec;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(content.preheader ?? "")}</span>
<table role="presentation" width="100%" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:${c.darkGreen};padding:22px 28px"><div style="color:${c.gold};font-size:11px;letter-spacing:0.24em;font-weight:700;text-transform:uppercase">${esc(s.brand.businessName)}</div><div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:0.04em;margin-top:2px">${esc(s.brand.competitionName.toUpperCase())}</div></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 18px;font-size:22px;color:#10241b">${esc(content.heading)}</h1>${html.join("")}</td></tr>
<tr><td style="padding:18px 28px;background:#fafaf7;color:#8a948f;font-size:12px;line-height:1.5">${esc(footer)}${content.footerNote ? `<br/>${esc(content.footerNote)}` : ""}<br/>This is a service email about your competition entry.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: content.subject, html: doc, text: [content.heading, "", ...text, "--", footer].join("\n") };
}
