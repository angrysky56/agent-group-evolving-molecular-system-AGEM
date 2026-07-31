/**
 * Run 2026-07-31T06-00-34: 118 seconds of generation, `schema-invalid`,
 * glossary size 0 — on a corpus that had extracted cleanly on the four
 * preceding runs. `parseClosedGlossary` is all-or-nothing, so one malformed
 * entry discarded every valid one and the run ended with no vocabulary.
 */

import { describe, expect, it } from "vitest";
import {
  parseClosedGlossary,
  parseClosedGlossaryPartial,
} from "./claim-extractor.js";

const ok = (label: string) => ({
  label,
  kind: "property",
  definition: `the ${label} property`,
  sourceForms: [label.replace(/-/g, " ")],
});

describe("one bad entry no longer discards the good ones", () => {
  it("keeps the valid entries and names the casualty", () => {
    const { entries, dropped } = parseClosedGlossaryPartial({
      glossary: [
        ok("qualia"),
        { label: "phenomenal-consciousness", kind: "property" }, // no definition
        ok("access-consciousness"),
      ],
    });
    expect(entries.map((e) => e.label).sort()).toEqual([
      "access-consciousness",
      "qualia",
    ]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.label).toBe("phenomenal-consciousness");
  });

  it("is a no-op when the glossary is already valid", () => {
    const input = { glossary: [ok("qualia"), ok("intentionality")] };
    const { entries, dropped } = parseClosedGlossaryPartial(input);
    expect(entries).toEqual(parseClosedGlossary(input));
    expect(dropped).toEqual([]);
  });

  it("accepts an axis whose values appear later in the array", () => {
    /*
     * Order matters to the strict parser, so a single forward pass would drop
     * a perfectly good axis for referencing values it had not reached yet.
     * The sweep repeats until nothing new becomes admissible.
     */
    const { entries, dropped } = parseClosedGlossaryPartial({
      glossary: [
        {
          label: "wavefunction-status",
          kind: "axis",
          axisEncoding: "categorical",
          definition: "the status of psi",
          sourceForms: ["wavefunction status"],
          values: ["psi-ontic", "psi-epistemic"],
        },
        {
          label: "psi-ontic",
          kind: "axis-value",
          axis: "wavefunction-status",
          definition: "psi is a physical state",
          sourceForms: ["psi ontic"],
        },
        {
          label: "psi-epistemic",
          kind: "axis-value",
          axis: "wavefunction-status",
          definition: "psi is knowledge",
          sourceForms: ["psi epistemic"],
        },
      ],
    });
    expect(dropped).toEqual([]);
    expect(entries).toHaveLength(3);
  });

  it("drops an orphaned axis-value rather than the whole vocabulary", () => {
    const { entries, dropped } = parseClosedGlossaryPartial({
      glossary: [
        ok("qualia"),
        {
          label: "psi-ontic",
          kind: "axis-value",
          axis: "wavefunction-status", // parent absent entirely
          definition: "psi is a physical state",
          sourceForms: ["psi ontic"],
        },
      ],
    });
    expect(entries.map((e) => e.label)).toEqual(["qualia"]);
    expect(dropped[0]!.label).toBe("psi-ontic");
  });
});

describe("what partial acceptance still refuses", () => {
  it("reports nothing salvaged when nothing is valid", () => {
    const { entries, dropped } = parseClosedGlossaryPartial({
      glossary: [{ label: "x" }, { kind: "property" }],
    });
    expect(entries).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  it("returns empty for input that is not a glossary at all", () => {
    expect(parseClosedGlossaryPartial({ nope: true }).entries).toEqual([]);
    expect(parseClosedGlossaryPartial(null).entries).toEqual([]);
  });

  it("never invents an entry that was not in the response", () => {
    // The line separating this from repairing a TRUNCATED glossary: dropping
    // a visible bad entry is reportable; fabricating a missing one is not.
    const { entries } = parseClosedGlossaryPartial({
      glossary: [ok("qualia"), { label: "broken", kind: "property" }],
    });
    expect(entries.map((e) => e.label)).toEqual(["qualia"]);
  });

  it("keeps the strict parser strict for every other caller", () => {
    expect(
      parseClosedGlossary({
        glossary: [ok("qualia"), { label: "broken", kind: "property" }],
      }),
    ).toBeNull();
  });
});
