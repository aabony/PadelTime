import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOtpEmail } from "../src/worker/lib/email";
import type { Env } from "../src/worker/env";

const env = { RESEND_API_KEY: "re_test", MAIL_FROM: "PadelTime <login@example.com>" } as Env;
const reply = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "{}" : "nope", { status, headers });

describe("sendOtpEmail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const run = async (fetcher: typeof fetch) => {
    const done = sendOtpEmail(env, "a@b.co", "123456", fetcher).then(
      () => "sent",
      (e: Error) => e.message,
    );
    await vi.runAllTimersAsync();
    return done;
  };

  it("sends once when the provider answers", async () => {
    const fetcher = vi.fn(async () => reply(200));
    expect(await run(fetcher as unknown as typeof fetch)).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit (everyone signing in at once) and then delivers", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(429, { "retry-after": "1" })).mockResolvedValueOnce(reply(429)).mockResolvedValueOnce(reply(200));
    expect(await run(fetcher as unknown as typeof fetch)).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries a network failure or timeout", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("The operation timed out")).mockResolvedValueOnce(reply(200));
    expect(await run(fetcher as unknown as typeof fetch)).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry a request the provider rejects outright (bad address)", async () => {
    const fetcher = vi.fn(async () => reply(422));
    expect(await run(fetcher as unknown as typeof fetch)).toBe("Could not send the sign-in code email");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives up after three attempts", async () => {
    const fetcher = vi.fn(async () => reply(503));
    expect(await run(fetcher as unknown as typeof fetch)).toBe("Could not send the sign-in code email");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("every attempt carries a timeout", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return reply(200);
    });
    expect(await run(fetcher as unknown as typeof fetch)).toBe("sent");
  });
});
