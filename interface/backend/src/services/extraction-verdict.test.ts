import { describe, expect, it } from "vitest";
import {
  extractionFailureCauses,
  inconclusiveExtractionVerdict,
} from "./extraction-verdict.js";

describe("cause-specific extraction verdicts", () => {
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
        rejected: [{ segmentId: "s4", reason: "conversion failed" }],
      },
    );

    expect(Object.fromEntries(causes.map((cause) => [cause.code, cause.count])))
      .toEqual({
        "attribution-guard-rejections": 1,
        "storage-rejections": 1,
        "parse-failures": 1,
        "conversion-rejections": 1,
      });
  });
});
