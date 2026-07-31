/**
 * Cues match words, not typography.
 *
 * The qm-interpretations corpus states Bell as:
 *
 *   "No position can hold **all** of: locality, hidden variables assigning
 *    definite pre-existing outcomes, measurement independence, and empirical
 *    adequacy to quantum predictions."
 *
 * `JOINT_INCOMPATIBILITY_CUE` expects `hold\s+all`. ` **all**` is not `\s+all`.
 * Of the five theorems in that file, Bell is the ONLY one that emphasises the
 * word `all` — and it was the only one the detector missed, because the author
 * had bolded the load-bearing word.
 *
 * With no joint incompatibility required, the model was free to decompose each
 * theorem into unary properties. The run produced 48 property-assertions, 8
 * distinctions, 1 entailment and ZERO joint incompatibilities from a corpus
 * whose entire subject is six impossibility theorems — which is why the answer
 * key scored 0/6.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  sourceNamesAHolder,
  sourceRequiresJointIncompatibility,
  stripEmphasis,
} from "./claim-extractor.js";

const CORPUS = readFileSync(
  new URL("../../../../corpora/qm-interpretations/corpus.md", import.meta.url)
    .pathname,
  "utf8",
);

function theoremSection(name: string): string {
  return (
    CORPUS.split(/\n(?=### )/).find((section) =>
      section.startsWith(`### ${name}`),
    ) ?? ""
  );
}

describe("the joint-incompatibility cue survives emphasis", () => {
  it("detects Bell as stated in the corpus, bold and all", () => {
    const bell = theoremSection("Bell");
    expect(bell).toMatch(/hold \*\*all\*\* of/);
    expect(sourceRequiresJointIncompatibility(bell)).toBe(true);
  });

  it.each([
    "Kochen–Specker",
    "Frauchiger–Renner",
    "Leggett–Garg",
    "Brukner",
  ])("still detects %s", (name) => {
    expect(sourceRequiresJointIncompatibility(theoremSection(name))).toBe(true);
  });

  it.each([
    "No position can hold **all** of: a, b, c.",
    "No theory can hold _all_ of: a, b, c.",
    "No account can satisfy ***all*** of: a, b, c.",
    "No position can hold all of: a, b, c.",
  ])("is indifferent to how `all` is marked up: %s", (text) => {
    expect(sourceRequiresJointIncompatibility(text)).toBe(true);
  });

  it("does not fire on prose that merely mentions the words", () => {
    expect(
      sourceRequiresJointIncompatibility(
        "Bohm holds locality is given up, and all interpretations must say something.",
      ),
    ).toBe(false);
  });
});

describe("the attribution cue survives emphasis too", () => {
  it("reads a bolded holder as a holder", () => {
    // "**Bohm** argues" must read as "Bohm argues", or a claim belonging to a
    // named position gets flattened into the corpus's own voice.
    expect(sourceNamesAHolder("**Bohm** argues that particles have trajectories."))
      .toBe(true);
    expect(sourceNamesAHolder("*Critics* argue the account fails.")).toBe(true);
  });

  it("still treats the corpus's own voice as unattributed", () => {
    expect(sourceNamesAHolder("The corpus notes the **asymmetry** here.")).toBe(
      false,
    );
  });
});

describe("stripEmphasis", () => {
  it("removes markers without eating the words", () => {
    expect(stripEmphasis("hold **all** of")).toBe("hold all of");
    expect(stripEmphasis("_emphasis_ and ***strong***")).toBe(
      "emphasis and strong",
    );
  });

  it("leaves intra-word underscores alone", () => {
    // `measurement_independence` is a symbol, not emphasis.
    expect(stripEmphasis("measurement_independence")).toBe(
      "measurement_independence",
    );
  });
});
