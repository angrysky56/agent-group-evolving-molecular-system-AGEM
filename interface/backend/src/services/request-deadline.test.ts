import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestDeadline } from "./request-deadline.js";

describe("request deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts exactly at the configured wall-clock deadline", async () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(1_000);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.timedOut).toBe(false);
    expect(deadline.remainingMs()).toBe(1_000);

    await vi.advanceTimersByTimeAsync(999);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut).toBe(true);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.signal.reason).toMatchObject({
      name: "RequestTimeoutError",
      timeoutMs: 1_000,
    });

    deadline.dispose();
  });

  it("propagates client cancellation without mislabelling it as a timeout", () => {
    vi.useFakeTimers();
    const client = new AbortController();
    const deadline = createRequestDeadline(1_000, client.signal);
    const reason = new Error("client disconnected");

    client.abort(reason);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.timedOut).toBe(false);
    deadline.dispose();
  });
});
