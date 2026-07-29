/**
 * arity-warning.test.ts
 *
 * Regression for a dead end that cost a whole run.
 *
 * The Coevolution block in run 2026-07-27T20-52-14 used
 * `biosynthetic_precursor` with one argument and with two. Prover9 rejects the
 * block outright, so it never entered the search. The engine now performs its
 * own local and cross-block set validation before calling mcp-logic, naming the
 * exact symbol and assertion contexts without spending prover budget.
 */

import { describe, it, expect } from "vitest";
import { analyzeFormalization, type LogicalBlock } from "./logicalCohomology.js";

/** The real block, trimmed to the formulas that matter. */
const coevolution: LogicalBlock = {
  name: "Coevolution with Biosynthesis core",
  propositions: [
    "exists x (codon(x))",
    "exists x (amino_acid(x))",
    "exists x (biosynthetic_precursor(x))",
    "exists x (biosynthetic_precursor(glutamate, glutamine))",
    "exists x (biosynthetic_precursor(aspartate, asparagine))",
    "all x (assignment(x) -> -arbitrariness(x))",
  ],
};

const arityWarnings = (blocks: LogicalBlock[]) =>
  analyzeFormalization(blocks).filter((w) => w.code === "inconsistent_arity");

describe("analyzeFormalization — inconsistent arity", () => {
  it("catches the symbol during local conversion preflight", () => {
    const [warning] = arityWarnings([coevolution]);
    expect(warning).toBeDefined();
    expect(warning.severity).toBe("critical");
    expect(warning.detail?.join(" ")).toContain("biosynthetic_precursor");
    expect(warning.detail?.join(" ")).toContain("1 and 2");
  });

  it("names the block, so a multi-block run knows which to fix", () => {
    const [warning] = arityWarnings([coevolution]);
    expect(warning.message).toContain("Coevolution with Biosynthesis core");
  });

  it("says explicitly that no prover budget was spent", () => {
    const [warning] = arityWarnings([coevolution]);
    expect(warning.message).toMatch(/preflight.*before any prover budget/i);
  });

  it("stays silent when every symbol has a fixed arity", () => {
    expect(
      arityWarnings([
        {
          name: "clean",
          propositions: [
            "exists x (amino_acid(x))",
            "precursor_of(glutamate, glutamine)",
            "precursor_of(aspartate, asparagine)",
            "all x (amino_acid(x) -> -codon(x))",
          ],
        },
      ]),
    ).toHaveLength(0);
  });

  it("does not mistake quantifiers for symbols", () => {
    expect(
      arityWarnings([
        {
          name: "quantified",
          propositions: [
            "all x (p(x) -> q(x))",
            "exists x (p(x))",
            "all x all y (r(x, y) -> -s(x))",
            "exists x exists y (r(x, y))",
          ],
        },
      ]),
    ).toHaveLength(0);
  });

  it("reports per block, not once for the whole set", () => {
    const warnings = arityWarnings([
      coevolution,
      { ...coevolution, name: "Second bad block" },
      { name: "fine", propositions: ["p(a)", "-p(a)"] },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.message).join(" ")).toContain(
      "Second bad block",
    );
  });

  it("also catches a collision that exists only across blocks", () => {
    const warnings = arityWarnings([
      { name: "Attribution", propositions: ["holds(fdt, lesion_adequate)"] },
      { name: "Rule", propositions: ["-lesion_adequate(fdt)"] },
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/across assertion blocks/i);
    expect(warnings[0].detail).toEqual([
      expect.stringMatching(/lesion_adequate.*arity 0 and 1.*Attribution.*Rule/i),
    ]);
  });
});
