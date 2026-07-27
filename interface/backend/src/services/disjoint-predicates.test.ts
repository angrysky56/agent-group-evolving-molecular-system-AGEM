/**
 * disjoint-predicates.test.ts
 *
 * Blocks over disjoint vocabularies are jointly satisfiable by construction, so
 * "no contradiction" across them is a fact about the encoding, not the claims.
 *
 * This is the defect that survived the no-paraphrase fix. Run
 * 2026-07-27T20-52-14 quantified over real corpus entities and used proper
 * negation — every existing check passed — but Frozen Accident predicated
 * `arbitrary` of `allocation_of_particular_codons_to_particular_amino_acids`
 * while Stereochemical Affinity predicated `-arbitrary` of `assignment`.
 * Nothing forces anything to be both, so the two positions could not collide
 * whatever the corpus said, and the run reported a clean verdict.
 */

import { describe, it, expect } from "vitest";
import { analyzeFormalization, type LogicalBlock } from "./logicalCohomology.js";

const disjointWarnings = (blocks: LogicalBlock[]) =>
  analyzeFormalization(blocks).filter((w) => w.code === "disjoint_predicates");

/** The real pair, reduced to the formulas that decide the question. */
const frozenAccident: LogicalBlock = {
  name: "Frozen Accident core",
  propositions: [
    "all x (allocation_of_particular_codons_to_particular_amino_acids(x) -> arbitrary(x))",
    "exists x (allocation_of_particular_codons_to_particular_amino_acids(x))",
  ],
};
const stereochemical: LogicalBlock = {
  name: "Stereochemical Affinity core",
  propositions: [
    "all x (assignment(x) -> -arbitrary(x))",
    "exists x (assignment(x))",
  ],
};

describe("analyzeFormalization — disjoint predicates", () => {
  it("flags the real pair that shared a property but not a subject", () => {
    const [warning] = disjointWarnings([frozenAccident, stereochemical]);
    expect(warning).toBeDefined();
    expect(warning.severity).toBe("critical");
  });

  it("is not satisfied by a shared PROPERTY symbol alone", () => {
    // Both blocks use `arbitrary`. That is precisely what made this hard to
    // spot — the vocabularies overlap, but not where it matters.
    const subjects = disjointWarnings([frozenAccident, stereochemical])[0]
      .detail?.join(" ");
    expect(subjects).toContain("assignment");
  });

  it("stays silent once the blocks quantify over the same subject", () => {
    expect(
      disjointWarnings([
        {
          name: "Frozen Accident core",
          propositions: [
            "all x (assignment(x) -> arbitrary(x))",
            "exists x (assignment(x))",
          ],
        },
        stereochemical,
      ]),
    ).toHaveLength(0);
  });

  it("does not fire on a single block", () => {
    expect(disjointWarnings([frozenAccident])).toHaveLength(0);
  });

  it("treats ground atoms as their own subject", () => {
    expect(
      disjointWarnings([
        { name: "a", propositions: ["p(a)"] },
        { name: "b", propositions: ["-p(a)"] },
      ]),
    ).toHaveLength(0);
  });

  it("does NOT fire on the classic frustrated triple", () => {
    /*
     * p(x), p(x) -> q(x), -q(x) share no subject predicate either, and are a
     * real contradiction: the free variable ranges over the same individuals in
     * every block. The first version of this check flagged them, which would
     * have condemned the one encoding the engine is calibrated against.
     */
    expect(
      disjointWarnings([
        { name: "P", propositions: ["p(x)"] },
        { name: "PQ", propositions: ["p(x) -> q(x)"] },
        { name: "NQ", propositions: ["-q(x)"] },
      ]),
    ).toHaveLength(0);
  });

  it("requires the block to introduce its own witness", () => {
    // Same disjoint subjects, but no `exists` — the blocks share a domain, so
    // a contradiction remains reachable and there is nothing to warn about.
    expect(
      disjointWarnings([
        { name: "a", propositions: ["all x (alpha(x) -> hot(x))"] },
        { name: "b", propositions: ["all x (beta(x) -> -hot(x))"] },
      ]),
    ).toHaveLength(0);
  });

  it("names every isolated block, not just the first", () => {
    const warnings = disjointWarnings([
      frozenAccident,
      stereochemical,
      {
        name: "Third island",
        propositions: [
          "all x (weather(x) -> wet(x))",
          "exists x (weather(x))",
        ],
      },
    ]);
    const detail = warnings[0].detail?.join(" ") ?? "";
    expect(detail).toContain("Third island");
    expect(detail).toContain("Frozen Accident core");
  });
});
