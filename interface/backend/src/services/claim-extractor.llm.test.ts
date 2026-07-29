import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();

vi.mock("./llm.js", () => ({
  getActiveProvider: () => ({ chat }),
}));

import { proposeClaims } from "./claim-extractor.js";

describe("claim extraction generation profile", () => {
  beforeEach(() => chat.mockReset());

  it("uses deterministic JSON generation without paid reasoning", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ claims: [] }),
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(proposeClaims("A sentence.")).resolves.toEqual([]);
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { enabled: false },
        responseFormat: { type: "json_object" },
        temperature: 0,
      }),
    );
  });

  it("rejects even parseable output when the provider reports truncation", async () => {
    chat.mockResolvedValue({
      content: JSON.stringify({ claims: [] }),
      finishReason: "length",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    await expect(proposeClaims("A sentence.")).resolves.toBeNull();
  });
});
