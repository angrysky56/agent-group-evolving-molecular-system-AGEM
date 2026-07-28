import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRequestDeadline,
  ToolRequestDeadlineError,
} from "./request-deadline.js";

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

  it("attributes an expired request to the active tool without inflating tool time", () => {
    const error = new ToolRequestDeadlineError(
      "extract_and_verify_claims",
      84_238,
      1_200_000,
    );

    expect(error).toMatchObject({
      name: "ToolRequestDeadlineError",
      scope: "request",
      toolName: "extract_and_verify_claims",
      toolElapsedMs: 84_238,
      requestTimeoutMs: 1_200_000,
    });
    expect(error.message).toBe(
      "Request deadline expired while extract_and_verify_claims was active " +
        "(tool elapsed 84238ms; request budget 1200000ms).",
    );
  });
});
