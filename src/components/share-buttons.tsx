"use client";

import { Check, Download, Link2, Share2 } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass } from "./ui";

export function ShareButtons({ imageUrl, pageUrl, title, filename }: { imageUrl: string; pageUrl: string; title: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const share = async () => {
    setErr(null);
    try {
      const blob = await (await fetch(imageUrl)).blob();
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title, url: pageUrl });
      else if (navigator.share) await navigator.share({ title, url: pageUrl });
      else setErr("Sharing isn't supported in this browser — download the image instead.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr("Couldn't open the share sheet.");
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={share} size="lg"><Share2 className="size-4" /> Share</Button>
      <a href={imageUrl} download={filename} className={buttonClass("secondary", "lg")}><Download className="size-4" /> Download</a>
      <Button
        variant="secondary"
        size="lg"
        onClick={async () => {
          await navigator.clipboard.writeText(pageUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />} {copied ? "Copied" : "Copy link"}
      </Button>
      {err && <p className="w-full text-sm text-muted">{err}</p>}
    </div>
  );
}
