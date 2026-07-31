/**
 * The sieve is cast once, audited, and reused.
 *
 * Two consecutive baseline runs over the SAME corpus produced 46 glossary
 * entries then 34, and 55 accepted claims then 15. That variance is in the
 * instrument, not the material — and an instrument whose divisions move
 * between readings cannot be scored against an answer key.
 *
 * Hobbes's condition is "generall names AGREED UPON". Agreed means settled and
 * shared, not re-derived every time one reasons.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedGlossaryEntry } from "./claim-extractor.js";

const chat = vi.fn();
vi.mock("./llm.js", () => ({ getActiveProvider: () => ({ chat }) }));

const { extendClosedGlossary, looksLikeDocumentStructure } = await import(
  "./claim-extractor.js"
);

const EXISTING: ClosedGlossaryEntry[] = [
  {
    label: "dominance",
    kind: "property",
    definition: "a decision rule preferring an act better in every state",
    sourceForms: ["dominance principle"],
  },
];

const NEED = [
  {
    segmentId: "s1",
    text: "Section 4 shows the impossibility: no theory satisfies dominance and newcomb adequacy together. The genetic lesion case turns on correlation without causation.",
    reason: "no closed label represents the impossibility result",
    candidateLabels: ["section-4-impossibility"],
  },
];

function respond(glossary: unknown[]) {
  chat.mockResolvedValue({
    content: JSON.stringify({ glossary }),
    finishReason: "stop",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

beforeEach(() => chat.mockReset());

describe("document structure is not vocabulary", () => {
  it.each([
    "section-4-impossibility",
    "section_2",
    "chapter-3-results",
    "figure-1",
    "table-2-verdicts",
    "appendix-a",
  ])("refuses %s", (label) => {
    expect(looksLikeDocumentStructure(label)).toBe(true);
  });

  it.each(["dominance", "newcomb-adequacy", "genetic-lesion", "partition"])(
    "still admits the real concept %s",
    (label) => {
      expect(looksLikeDocumentStructure(label)).toBe(false);
    },
  );

  it("drops the heading the live run actually minted", async () => {
    // decision-theory baseline: the extension added `section-4-impossibility`
    // as a claim role. A predicate over it says where the sentence sat on the
    // page, not anything about decision theory.
    respond([
      {
        label: "section-4-impossibility",
        kind: "property",
        definition: "the impossibility shown in section 4",
        sourceForms: ["Section 4 shows the impossibility"],
      },
      {
        label: "genetic-lesion",
        kind: "entity",
        definition: "the lesion that causes both cancer and the desire to smoke",
        sourceForms: ["genetic lesion"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING);
    expect(additions.map((a) => a.label)).toEqual(["genetic-lesion"]);
    expect(rejected[0]!.why).toMatch(/document's structure rather than a concept/);
  });
});

describe("the audited ontology binds the extension", () => {
  it("refuses a label the ontology already rules on as an alias", async () => {
    /*
     * reverse-math's ontology.json: "rt22 and rt_n_k are DIFFERENT statements
     * with different strengths. Any alias between them destroys the corpus."
     * An extension minting an audited alias as a fresh concept re-splits what
     * a person deliberately settled.
     */
    respond([
      {
        label: "dominance-principle",
        kind: "property",
        definition: "a rule preferring an act better in every state",
        sourceForms: ["dominance principle"],
      },
    ]);
    /*
     * The ontology spells the alias with an underscore; the extension proposes
     * it with a hyphen. A literal key lookup misses — this is the guard that
     * catches it, and near-identical spellings are exactly the shape the
     * rt22 / rt_n_k warning is about.
     */
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING, {
      dominance_principle: "dominance",
    });
    expect(additions).toEqual([]);
    expect(rejected[0]!.why).toMatch(/already rules on this string as an alias/);
  });

  it("catches the literal spelling too, by the canonical-mismatch guard", async () => {
    respond([
      {
        label: "dominance-principle",
        kind: "property",
        definition: "a rule preferring an act better in every state",
        sourceForms: ["dominance principle"],
      },
    ]);
    const { additions, rejected } = await extendClosedGlossary(NEED, EXISTING, {
      "dominance-principle": "dominance",
    });
    expect(additions).toEqual([]);
    expect(rejected[0]!.why).toMatch(/maps this label to a different canonical/);
  });

  it("still admits a genuinely new concept the ontology is silent about", async () => {
    respond([
      {
        label: "genetic-lesion",
        kind: "entity",
        definition: "the common cause of cancer and the desire to smoke",
        sourceForms: ["genetic lesion"],
      },
    ]);
    const { additions } = await extendClosedGlossary(NEED, EXISTING, {
      "dominance-principle": "dominance",
    });
    expect(additions.map((a) => a.label)).toEqual(["genetic-lesion"]);
  });
});
