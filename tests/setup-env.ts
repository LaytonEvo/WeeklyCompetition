import { config } from "dotenv";
import { vi } from "vitest";

config({ path: ".env.test", override: true });
(process.env as Record<string, string>).NODE_ENV = "test";

// `server-only` throws outside a React Server environment; it's a no-op for tests.
vi.mock("server-only", () => ({}));
