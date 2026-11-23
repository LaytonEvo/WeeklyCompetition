export const STATUS_TONE: Record<string, "neutral" | "green" | "gold" | "danger" | "warn" | "blue"> = {
  draft: "neutral",
  pending_approval: "warn",
  scheduled: "blue",
  open: "green",
  closed: "warn",
  awaiting_verification: "warn",
  finalised: "gold",
  archived: "neutral",
  cancelled: "danger",
};
