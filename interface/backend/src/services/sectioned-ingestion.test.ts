import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_AGEM_CYCLE_DESCRIPTION,
  RUN_SECTIONED_CYCLES_DESCRIPTION,
  planSectionedIngestion,
} from "./sectioned-ingestion.js";

const characterCounter = { countTokens: (text: string) => text.length };

describe("planSectionedIngestion", () => {
  it("tells the model that one cycle is one subgraph and points structured corpora to sectioning", () => {
    expect(RUN_AGEM_CYCLE_DESCRIPTION).toMatch(/one named subgraph/i);
    expect(RUN_AGEM_CYCLE_DESCRIPTION).toMatch(/cohomology requires at least two/i);
    expect(RUN_AGEM_CYCLE_DESCRIPTION).toContain("run_agem_cycles_sectioned");
    expect(RUN_SECTIONED_CYCLES_DESCRIPTION).toMatch(/one.*cycle per named subgraph/i);
  });

  it("plans one named cycle per markdown section and merges a short preamble forward", () => {
    const plan = planSectionedIngestion(
      [
        "# Corpus title",
        "short ingestion note",
        "## First field",
        "alpha bridge material with enough detail",
        "## Second field",
        "beta bridge material with enough detail",
      ].join("\n"),
      { minSectionTokens: 40, tokenCounter: characterCounter },
    );

    expect(plan).toHaveLength(2);
    expect(plan.map((section) => section.subgraph)).toEqual([
      "first-field",
      "second-field",
    ]);
    expect(plan[0]!.text).toContain("# Corpus title");
    expect(plan[0]!.text).toContain("## First field");
    expect(plan[0]!.lcmEntries.length).toBeGreaterThan(1);
    expect(plan[1]!.heading).toBe("Second field");
  });

  it("preserves the authored section counts of every exploration corpus", () => {
    const corpora = [
      ["decision-theory", "^## ", 9],
      ["reverse-math", "^## ", 4],
      ["quantum-mind-genesis", "^## ", 5],
      ["qm-interpretations", "^### ", 16],
    ] as const;

    for (const [name, sectionPattern, expected] of corpora) {
      const source = readFileSync(
        path.resolve(import.meta.dirname, "../../../../corpora", name, "corpus.md"),
        "utf8",
      );
      expect(
        planSectionedIngestion(source, { sectionPattern }),
        name,
      ).toHaveLength(expected);
    }
  });

  it("fails before execution when the split is singular or exceeds its cap", () => {
    expect(() =>
      planSectionedIngestion("# No matching second-level heading"),
    ).toThrow(/at least 2 named subgraphs/i);

    const oversized = Array.from(
      { length: 4 },
      (_, index) => `## Section ${index + 1}\n\n${"substantive material ".repeat(40)}`,
    ).join("\n\n");
    expect(() =>
      planSectionedIngestion(oversized, { maxSections: 3 }),
    ).toThrow(/exceeding maxSections=3/i);
  });
});
