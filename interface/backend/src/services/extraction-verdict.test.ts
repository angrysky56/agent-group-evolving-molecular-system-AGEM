import { describe, expect, it } from "vitest";
import {
  applyExtractionCoverage,
  extractionFailureCauses,
  inconclusiveFormalizationVerdict,
  inconclusiveExtractionVerdict,
} from "./extraction-verdict.js";

describe("cause-specific extraction verdicts", () => {
  it("names the critical formalization codes that actually fired", () => {
    const verdict = inconclusiveFormalizationVerdict([
      {
        code: "inconsistent_arity",
        severity: "critical",
        message: "Seven symbols have inconsistent arity.",
      },
      {
        code: "isolated_predicates",
        severity: "warning",
        message: "One block is isolated.",
      },
    ]);

    expect(verdict).toMatch(/INCONCLUSIVE FORMALIZATION/i);
    expect(verdict).toMatch(/inconsistent_arity/i);
    expect(verdict).toMatch(/Seven symbols/i);
    expect(verdict).not.toMatch(/attribution/i);
    expect(verdict).not.toMatch(/isolated_predicates/i);
  });

  it("names schema rejection without inventing an attribution failure", () => {
    const causes = extractionFailureCauses(
      {
        outcomes: [
          {
            segmentId: "s7",
            claim: {
              kind: "dissociation",
              roles: { dissociable: "influence-over-termites" },
              scope: "corpus",
            },
            accepted: false,
            rejectionKind: "schema",
            rejection:
              "schema cardinality: dissociation role 'dissociable' requires at least 2 distinct values; found 1",
          },
        ],
        parseFailures: [],
      },
      { attributionIssues: [], rejected: [] },
    );

    expect(causes).toEqual([
      expect.objectContaining({ code: "schema-rejections", count: 1 }),
    ]);
    const verdict = inconclusiveExtractionVerdict(causes);
    expect(verdict).toMatch(/1 claim.*schema.*cardinality/i);
    expect(verdict).not.toMatch(/lacked valid attribution/i);
  });

  it("reports each fired channel with its exact count", () => {
    const causes = extractionFailureCauses(
      {
        outcomes: [
          {
            segmentId: "s1",
            claim: {
              kind: "entailment",
              roles: { antecedent: "a", consequent: "b" },
              scope: "corpus",
            },
            accepted: false,
            rejectionKind: "attribution",
          },
          {
            segmentId: "s2",
            claim: {
              kind: "entailment",
              roles: { antecedent: "a", consequent: "b" },
              scope: "corpus",
            },
            accepted: false,
            rejectionKind: "storage",
          },
        ],
        parseFailures: ["s3"],
      },
      {
        attributionIssues: [],
        rejected: [
          {
            segmentId: "s4",
            reason: "conversion failed",
            rejectionKind: "conversion",
          },
          {
            segmentId: "s5",
            reason: "pronoun subject 'this' has no stable referent",
            rejectionKind: "quality",
          },
        ],
      },
    );

    expect(Object.fromEntries(causes.map((cause) => [cause.code, cause.count])))
      .toEqual({
        "attribution-guard-rejections": 1,
        "storage-rejections": 1,
        "parse-failures": 1,
        "conversion-rejections": 1,
        "quality-rejections": 1,
      });
  });

  it("makes glossary, unmappable, and out-of-vocabulary failures explicit", () => {
    const causes = extractionFailureCauses(
      {
        glossaryFailure: "invalid glossary",
        unmappableClaims: [
          { segmentId: "s1", reason: "no vocabulary entry for calibration" },
        ],
        outcomes: [
          {
            segmentId: "s2",
            claim: {
              kind: "entailment",
              roles: {
                antecedent: "theory-that-holds-dominance",
                consequent: "dominance",
              },
              scope: "corpus",
            },
            accepted: false,
            rejectionKind: "vocabulary",
          },
        ],
        parseFailures: [],
      },
      { attributionIssues: [], rejected: [] },
    );

    expect(Object.fromEntries(causes.map((cause) => [cause.code, cause.count])))
      .toEqual({
        "glossary-failure": 1,
        "unmappable-claims": 1,
        "vocabulary-rejections": 1,
      });
    expect(inconclusiveExtractionVerdict(causes)).toMatch(
      /closed corpus vocabulary/i,
    );
  });

  it("keeps partial contradictions checkable but refuses a partial clean verdict", () => {
    expect(
      applyExtractionCoverage(
        { verdictKind: "no-contradiction", semanticsValidated: true },
        { corpusComplete: false, capped: false },
      ),
    ).toEqual({
      verdictKind: "inconclusive",
      semanticsValidated: false,
    });
    expect(
      applyExtractionCoverage(
        { verdictKind: "corpus-contradiction", semanticsValidated: true },
        { corpusComplete: false, capped: false },
      ),
    ).toEqual({
      verdictKind: "corpus-contradiction",
      semanticsValidated: true,
    });
  });
});
