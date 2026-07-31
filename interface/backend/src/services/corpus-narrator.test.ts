/**
 * Consciousness run, reported by the engine in its own words:
 *
 *   "The repair route produced zero candidates for any of the 6 distinct
 *    attribution failures... If the corpus is speaking in its own voice, the
 *    fix would require a human or an audited ontology — a corpus-narrator
 *    position — which is outside the claim-level patch vocabulary this system
 *    can apply."
 *
 * It does not require a human. A document has an author; that is entailed by
 * there being a document. These tests pin that the narrator can be proposed
 * without ever stealing a claim from a named holder.
 */

import { describe, expect, it } from "vitest";
import {
  CORPUS_NARRATOR_LABEL,
  corpusNarratorEntry,
  sourceNamesAHolder,
  type ClosedGlossaryEntry,
} from "./claim-extractor.js";
import { collectExtractionRepairProposals } from "./extraction-repairs.js";

const GLOSSARY: ClosedGlossaryEntry[] = [
  {
    label: "bohm",
    kind: "entity",
    definition: "the Bohmian position",
    sourceForms: ["Bohm"],
  },
  corpusNarratorEntry(),
];

function proposalsFor(text: string) {
  return collectExtractionRepairProposals({
    segments: [{ id: "s1", text }],
    extraction: { glossary: GLOSSARY, unmappableClaims: [], outcomes: [] },
    attributionIssues: [{ segmentId: "s1", reason: "no valid assertion context" }],
  });
}

describe("the corpus's own voice is a holder", () => {
  it("proposes the narrator when the segment names nobody", () => {
    // The exact shape that produced zero candidates.
    const [proposal] = proposalsFor(
      "The corpus notes the asymmetry between the two classes of result.",
    );
    expect(proposal!.candidates).toHaveLength(1);
    expect(proposal!.candidates[0]!.patch).toMatchObject({
      operation: "set-attribution",
      scope: "position",
      positionId: CORPUS_NARRATOR_LABEL,
    });
  });

  it("prefers a named holder over the narrator when the text has one", () => {
    const [proposal] = proposalsFor("Bohm rejects the collapse postulate.");
    expect(proposal!.candidates).toHaveLength(1);
    expect(proposal!.candidates[0]!.patch).toMatchObject({ positionId: "bohm" });
  });

  it("refuses the narrator when the text attributes to someone unnamed in the glossary", () => {
    /*
     * The load-bearing guard. "Critics argue that..." names a holder the
     * glossary does not contain — the right repair is to find that holder, not
     * to hand the claim to the author. Silently reassigning it would be the
     * attribution flattening the guard exists to catch.
     */
    const [proposal] = proposalsFor(
      "Critics argue that the higher-order account fails on animal cases.",
    );
    expect(proposal!.candidates).toEqual([]);
  });

  it("offers nothing when no narrator exists in the glossary", () => {
    const proposals = collectExtractionRepairProposals({
      segments: [{ id: "s1", text: "The corpus notes an asymmetry." }],
      extraction: {
        glossary: [GLOSSARY[0]!],
        unmappableClaims: [],
        outcomes: [],
      },
      attributionIssues: [{ segmentId: "s1", reason: "no valid assertion context" }],
    });
    expect(proposals[0]!.candidates).toEqual([]);
  });
});

describe("the holder test", () => {
  it.each([
    "Bohm argues that particles have definite trajectories.",
    "Proponents of the global workspace claim access is sufficient.",
    "According to the higher-order view, awareness requires a meta-state.",
  ])("recognises an attributed source: %s", (text) => {
    expect(sourceNamesAHolder(text)).toBe(true);
  });

  it.each([
    "The corpus notes the asymmetry between the two classes of result.",
    "This paper argues from the structure of the debate itself.",
    "Any theory that denies observer-independence faces this problem.",
  ])("treats an unattributed or generic statement as the corpus's own: %s", (text) => {
    expect(sourceNamesAHolder(text)).toBe(false);
  });
});
