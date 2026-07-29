import { describe, it, expect } from "vitest";
import { settings } from "./config.js";

describe("ConfigService — update and Zod schema re-validation", () => {
  it("allows updating EMBEDDING_PROVIDER without ZodError on transformed boolean fields", () => {
    expect(settings.all.CHAT_ENFORCE_WORKFLOW_CONTRACT).toBeTypeOf("boolean");

    const result = settings.update({ EMBEDDING_PROVIDER: "ollama" });
    expect(result).toBe(true);
    expect(settings.toSystemConfig().embedding_provider).toBe("ollama");
  });

  it("handles updating CHAT_ENFORCE_WORKFLOW_CONTRACT with string or boolean values", () => {
    expect(settings.update({ CHAT_ENFORCE_WORKFLOW_CONTRACT: "false" as any })).toBe(true);
    expect(settings.all.CHAT_ENFORCE_WORKFLOW_CONTRACT).toBe(false);

    expect(settings.update({ CHAT_ENFORCE_WORKFLOW_CONTRACT: true as any })).toBe(true);
    expect(settings.all.CHAT_ENFORCE_WORKFLOW_CONTRACT).toBe(true);
  });

  it("exposes provider output caps and accepts only positive integer updates", () => {
    const originalOpenRouter = settings.all.OPENROUTER_MAX_TOKENS;
    const originalAnthropic = settings.all.ANTHROPIC_MAX_TOKENS;

    expect(settings.toSystemConfig()).toMatchObject({
      openrouter_max_tokens: originalOpenRouter,
      anthropic_max_tokens: originalAnthropic,
    });

    expect(
      settings.update({
        OPENROUTER_MAX_TOKENS: 12_345,
        ANTHROPIC_MAX_TOKENS: 6_789,
      }),
    ).toBe(true);
    expect(settings.toSystemConfig()).toMatchObject({
      openrouter_max_tokens: 12_345,
      anthropic_max_tokens: 6_789,
    });

    expect(settings.update({ OPENROUTER_MAX_TOKENS: 0 })).toBe(false);
    expect(settings.update({ ANTHROPIC_MAX_TOKENS: 1.5 })).toBe(false);
    expect(settings.toSystemConfig()).toMatchObject({
      openrouter_max_tokens: 12_345,
      anthropic_max_tokens: 6_789,
    });

    expect(
      settings.update({
        OPENROUTER_MAX_TOKENS: originalOpenRouter,
        ANTHROPIC_MAX_TOKENS: originalAnthropic,
      }),
    ).toBe(true);
  });

  it("provides a configurable positive request deadline", () => {
    const originalTurns = settings.all.CHAT_MAX_TURNS;
    const original = settings.all.CHAT_REQUEST_TIMEOUT_MS;
    const originalExtractionMinimum =
      settings.all.CLAIM_EXTRACTION_MIN_REMAINING_MS;
    expect(originalTurns).toBe(64);
    expect(original).toBe(45 * 60 * 1000);
    expect(originalExtractionMinimum).toBe(8 * 60 * 1000);

    expect(settings.update({ CHAT_REQUEST_TIMEOUT_MS: 90_000 } as any)).toBe(
      true,
    );
    expect(settings.all.CHAT_REQUEST_TIMEOUT_MS).toBe(90_000);
    expect(settings.update({ CHAT_REQUEST_TIMEOUT_MS: 0 } as any)).toBe(false);
    expect(settings.update({ CHAT_MAX_TURNS: 24 } as any)).toBe(true);
    expect(settings.all.CHAT_MAX_TURNS).toBe(24);
    expect(settings.update({ CHAT_MAX_TURNS: 0 } as any)).toBe(false);
    expect(settings.update({ CHAT_MAX_TURNS: 1.5 } as any)).toBe(false);
    expect(
      settings.update({ CLAIM_EXTRACTION_MIN_REMAINING_MS: 120_000 } as any),
    ).toBe(true);
    expect(settings.all.CLAIM_EXTRACTION_MIN_REMAINING_MS).toBe(120_000);
    expect(
      settings.update({ CLAIM_EXTRACTION_MIN_REMAINING_MS: 0 } as any),
    ).toBe(false);

    expect(settings.update({ CHAT_REQUEST_TIMEOUT_MS: original } as any)).toBe(
      true,
    );
    expect(settings.update({ CHAT_MAX_TURNS: originalTurns } as any)).toBe(true);
    expect(
      settings.update({
        CLAIM_EXTRACTION_MIN_REMAINING_MS: originalExtractionMinimum,
      } as any),
    ).toBe(true);
  });
});
