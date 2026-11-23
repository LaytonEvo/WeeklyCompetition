import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for admin-authored rules/terms. Supports
 * headings (#, ##, ###), paragraphs, bullet/numbered lists, **bold**,
 * _italic_ and blockquotes. Never injects raw HTML.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong> : <em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "mt-8 font-display text-3xl font-bold uppercase text-pine" : level === 2 ? "mt-8 text-xl font-semibold text-ink" : "mt-6 font-semibold text-ink";
      const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2";
      blocks.push(<Tag key={k++} className={cls}>{inline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        <L key={k++} className={`mt-3 space-y-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-gold`}>
          {items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`)}</li>)}
        </L>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++} className="mt-4 rounded-xl border-l-4 border-gold bg-gold-50 px-4 py-3 text-[#6b4f1d]">{inline(q.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="mt-3">{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className={`leading-relaxed text-ink-soft ${className ?? ""}`}>{blocks}</div>;
}
