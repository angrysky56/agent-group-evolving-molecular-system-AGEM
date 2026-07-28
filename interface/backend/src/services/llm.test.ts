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
});
