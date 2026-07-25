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
});
