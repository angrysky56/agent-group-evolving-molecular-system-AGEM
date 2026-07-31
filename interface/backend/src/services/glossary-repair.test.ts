/**
 * Run 2026-07-30T23-36-00: 64 segments, one glossary call, 28 seconds, size 0,
 * whole run terminal. The failure was reported as "an invalid or truncated
 * corpus glossary" — one message covering two opposite problems, pointing at
 * neither, with jsonRepair.ts sitting unused in the same repository.
 */

import { describe, expect, it } from "vitest";
import { repairGlossaryJson } from "./claim-extractor.js";

const VALID = '{"glossary":[{"label":"codon","kind":"property","definition":"a triplet","sourceForms":["codon"]}]}';

describe("repairing formatting the model got wrong", () => {
  it("leaves already-valid JSON exactly as it is", () => {
    expect(repairGlossaryJson(VALID)).toEqual(JSON.parse(VALID));
  });

  it("strips a markdown code fence", () => {
    expect(repairGlossaryJson("```json\n" + VALID + "\n```")).toEqual(
      JSON.parse(VALID),
    );
  });

  it("removes a trailing comma — the one-character run-ender", () => {
    const withComma = VALID.replace("}]}", "},]}");
    expect(repairGlossaryJson(withComma)).toEqual(JSON.parse(VALID));
  });

  it("converts single-quoted strings", () => {
    const salvaged = repairGlossaryJson(
      "{'glossary':[{'label':'codon','kind':'property','definition':'a triplet','sourceForms':['codon']}]}",
    ) as { glossary?: unknown[] };
    expect(Array.isArray(salvaged?.glossary)).toBe(true);
  });
});

describe("what repair must refuse to do", () => {
  it("does not close an unterminated structure", () => {
    /*
     * The load-bearing refusal. Closing a truncated glossary would invent the
     * entries the model never wrote, and a fabricated label becomes a
     * predicate the corpus does not contain — pass two would then extract
     * claims over vocabulary with no source. A short vocabulary that looks
     * complete is worse than an honest failure.
     */
    const truncated =
      '{"glossary":[{"label":"codon","kind":"property","definition":"a trip';
    expect(repairGlossaryJson(truncated)).toBeNull();
  });

  it("returns null on content that is not JSON at all", () => {
    expect(repairGlossaryJson("I could not build a glossary for this corpus."))
      .toBeNull();
  });

  it("does not invent a glossary out of an empty response", () => {
    expect(repairGlossaryJson("")).toBeNull();
    expect(repairGlossaryJson("   \n  ")).toBeNull();
  });
});
