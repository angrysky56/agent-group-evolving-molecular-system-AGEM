import { describe, expect, it } from "vitest";
import type { ITokenCounter } from "#agem/lcm/interfaces.js";
import {
  FindingNarrativeDensifier,
  type FindingNarrativeDensifierOptions,
  type NarrativeCompletion,
} from "./finding-narrative.js";

const FACT = 'exclusion(excluder="phi",excluded="global-broadcast")';
const SOURCE =
  "The source says phi can be present while global broadcast is absent. ".repeat(
    8,
  );
const payload = (body: string) =>
  `SCHEMA_FACTS:\n${FACT}\nDENSE_NARRATIVE:\n${body}`;

class CharacterCounter implements ITokenCounter {
  countTokens(text: string): number {
    return text.length;
  }
}

class QueueCompletion implements NarrativeCompletion {
  readonly prompts: string[] = [];
  readonly options: Array<Parameters<NarrativeCompletion["complete"]>[1]> = [];

  constructor(readonly responses: Array<string | Error>) {}

  async complete(
    prompt: string,
    options: Parameters<NarrativeCompletion["complete"]>[1],
  ): Promise<string> {
    this.prompts.push(prompt);
    this.options.push(options);
    const response = this.responses.shift() ?? "";
    if (response instanceof Error) throw response;
    return response;
  }
}

function densifier(
  completion: NarrativeCompletion,
  overrides: Partial<FindingNarrativeDensifierOptions> = {},
): FindingNarrativeDensifier {
  return new FindingNarrativeDensifier(completion, {
    enabled: true,
    targetRatio: 0.5,
    maxPasses: 3,
    maxSourceTokens: 2000,
    maxOutputTokens: 1000,
    tokenCounter: new CharacterCounter(),
    ...overrides,
  });
}

describe("FindingNarrativeDensifier", () => {
  it("accepts a bounded payload only when every schema fact survives verbatim", async () => {
    const completion = new QueueCompletion([payload("phi⊥global-broadcast")]);
    const result = await densifier(completion).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });

    expect(result).toMatchObject({
      status: "condensed",
      passes: 1,
      missingFacts: [],
    });
    expect(result.condensedNarrative).toContain(FACT);
    expect(result.outputTokens).toBeLessThanOrEqual(result.targetTokens!);
    expect(completion.prompts[0]).toContain("without an external codebook");
    expect(completion.prompts[0]).toContain("Do not invent aliases");
    expect(completion.options[0]).toMatchObject({
      provider: "ollama",
      model: "model-a",
    });
  });

  it("uses deterministic missing-fact feedback for the next CoD pass", async () => {
    const completion = new QueueCompletion([
      "phi and broadcast differ",
      payload("phi≠broadcast"),
    ]);
    const result = await densifier(completion).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });

    expect(result.status).toBe("condensed");
    expect(result.passes).toBe(2);
    expect(completion.prompts[1]).toContain("Missing exact schema facts");
    expect(completion.prompts[1]).toContain(FACT);
  });

  it("rejects a fact mentioned outside the self-describing schema envelope", async () => {
    const completion = new QueueCompletion([
      `This might not hold: ${FACT}`,
    ]);
    const result = await densifier(completion, { maxPasses: 1 }).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });

    expect(result.status).toBe("fidelity-rejected");
    expect(result.missingFacts).toEqual([]);
    expect(result.note).toContain("schema envelope");
  });

  it("stores no payload when the bounded passes cannot satisfy the oracle", async () => {
    const completion = new QueueCompletion(["vague", "still vague"]);
    const result = await densifier(completion, { maxPasses: 2 }).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });

    expect(result).toMatchObject({
      status: "fidelity-rejected",
      passes: 2,
      missingFacts: [FACT],
    });
    expect(result.condensedNarrative).toBeUndefined();
  });

  it("refuses oversized source and impossible output budgets without a model call", async () => {
    const tooLarge = new QueueCompletion([]);
    const largeResult = await densifier(tooLarge, {
      maxSourceTokens: 50,
    }).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });
    expect(largeResult.status).toBe("source-too-large");
    expect(tooLarge.prompts).toEqual([]);

    const tooSmall = new QueueCompletion([]);
    const budgetResult = await densifier(tooSmall, {
      maxOutputTokens: 40,
    }).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });
    expect(budgetResult.status).toBe("budget-too-small");
    expect(tooSmall.prompts).toEqual([]);
  });

  it("reports provider failure instead of manufacturing a fallback payload", async () => {
    const result = await densifier(
      new QueueCompletion([new Error("provider unavailable")]),
    ).densify({
      sourceNarrative: SOURCE,
      schemaFacts: [FACT],
      model: "model-a",
      provider: "ollama",
    });

    expect(result).toMatchObject({
      status: "provider-error",
      passes: 1,
      note: "provider unavailable",
    });
    expect(result.condensedNarrative).toBeUndefined();
  });
});
