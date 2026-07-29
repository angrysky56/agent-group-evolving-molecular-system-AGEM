import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProvider,
  ProviderReadTimeoutError,
} from "./llm.js";

describe("OpenRouter stream liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails explicitly after 90 seconds of stream silence", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => {});
    const read = vi.fn(() => new Promise<never>(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: { getReader: () => ({ read, cancel }) },
      })),
    );
    const provider = createProvider("openrouter");

    const completion = provider.chat({
      messages: [{ role: "user", content: "hello" }],
    });
    const rejection = expect(completion).rejects.toBeInstanceOf(
      ProviderReadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(90_000);

    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a terminal error injected into an established SSE stream", async () => {
    const encoded = new TextEncoder().encode(
      'data: {"error":{"code":502,"message":"JSON error injected into SSE stream"},"choices":[{"finish_reason":"error"}]}\n\n',
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce({ value: encoded, done: false })
      .mockResolvedValueOnce({ value: undefined, done: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: { getReader: () => ({ read, cancel: vi.fn() }) },
      })),
    );
    const provider = createProvider("openrouter");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hello" }] }),
    ).rejects.toThrow("OpenRouter stream error");
  });

  it("passes task-specific reasoning and structured-output controls to OpenRouter", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        value: new TextEncoder().encode("data: [DONE]\n\n"),
        done: false,
      })
      .mockResolvedValueOnce({ value: undefined, done: true });
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => ({
      ok: true,
      body: { getReader: () => ({ read, cancel: vi.fn() }) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider("openrouter");

    await provider.chat({
      messages: [{ role: "user", content: "extract" }],
      reasoning: { enabled: false },
      responseFormat: { type: "json_object" },
      temperature: 0,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request!.body))).toMatchObject({
      reasoning: { enabled: false },
      response_format: { type: "json_object" },
      temperature: 0,
    });
  });
});
