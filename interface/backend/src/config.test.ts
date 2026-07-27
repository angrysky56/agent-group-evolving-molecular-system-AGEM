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
});
