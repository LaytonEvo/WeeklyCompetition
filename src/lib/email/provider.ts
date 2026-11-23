import { env } from "@/lib/env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-level idempotency key where supported. */
  idempotencyKey: string;
  category: "transactional" | "marketing";
}

export interface EmailProvider {
  name: string;
  send(msg: OutgoingEmail): Promise<{ id: string | null }>;
}

/** Development provider: nothing leaves the machine; messages are stored in the notifications table and logged. */
const logProvider: EmailProvider = {
  name: "log",
  async send(msg) {
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email:log] to=${msg.to} subject="${msg.subject}"\n${msg.text.slice(0, 600)}`);
    }
    return { id: null };
  },
};

const resendProvider: EmailProvider = {
  name: "resend",
  async send(msg) {
    const key = env().RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({ from: env().EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? null };
  },
};

const postmarkProvider: EmailProvider = {
  name: "postmark",
  async send(msg) {
    const token = env().POSTMARK_SERVER_TOKEN;
    if (!token) throw new Error("POSTMARK_SERVER_TOKEN is not configured");
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        From: env().EMAIL_FROM,
        To: msg.to,
        Subject: msg.subject,
        HtmlBody: msg.html,
        TextBody: msg.text,
        MessageStream: msg.category === "marketing" ? "broadcast" : "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { MessageID?: string };
    return { id: body.MessageID ?? null };
  },
};

export function emailProvider(): EmailProvider {
  switch (env().EMAIL_PROVIDER) {
    case "resend":
      return resendProvider;
    case "postmark":
      return postmarkProvider;
    default:
      return logProvider;
  }
}
