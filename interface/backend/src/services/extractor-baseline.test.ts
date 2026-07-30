import { describe, expect, it } from "vitest";
import {
  evaluateExtractorBaseline,
  type BaselineExtractionRun,
} from "./extractor-baseline.js";
import { canonicalClaim, type ExtractedClaim } from "./claim-extractor.js";

const a: ExtractedClaim = {
  kind: "exclusion",
  roles: { excluder: "alpha", excluded: "beta" },
  scope: "corpus",
};
const b: ExtractedClaim = {
  kind: "property-assertion",
  roles: { subject: "alpha", property: "gamma" },
  polarity: "asserts",
  scope: "corpus",
};

function run(id: string, claims: ExtractedClaim[]): BaselineExtractionRun {
  return {
    corpusId: "fixture",
    runId: id,
    segmentsProcessed: 2,
    outcomes: claims.map((claim, index) => ({
      segmentId: `s${index + 1}`,
      accepted: true,
      claim,
    })),
    unmappableSegmentIds: claims.length < 2 ? ["s2"] : [],
    latencyMs: 100,
    costUsd: 0.01,
    truncated: false,
    providerFailure: false,
  };
}

describe("extractor baseline evaluator", () => {
  it("leads with answer-key, coverage, and vacuity metrics and detects instability", () => {
    const report = evaluateExtractorBaseline(
      [run("r1", [a, b]), run("r2", [a, b]), run("r3", [a])],
      [
        {
          corpusId: "fixture",
          mustFind: [canonicalClaim(a), canonicalClaim(b)],
          mustNotFind: [],
        },
      ],
    );
    expect(report.scorecard).toMatchObject({
      mustFind: { found: 5, total: 6, recall: 5 / 6 },
      mustNotFindViolations: 0,
      coverage: { acceptedClaims: 5, segmentsProcessed: 6, ratio: 5 / 6 },
      vacuousRuns: 0,
    });
    expect(report.exactSegmentAgreement.ratio).toBe(0.5);
    expect(report.disagreement.omission).toBe(1);
    expect(report.disagreement.unmappable).toBe(1);
    expect(report.adaptiveSamplingRecommended).toBe(true);
    expect(report.operations.totalCostUsd).toBeCloseTo(0.03);
  });

  it("does not recommend sampling to conceal provider failures", () => {
    const failed = run("failed", []);
    failed.providerFailure = true;
    const report = evaluateExtractorBaseline([failed], []);
    expect(report.scorecard.vacuousRuns).toBe(1);
    expect(report.operations.providerFailureRuns).toBe(1);
    expect(report.adaptiveSamplingRecommended).toBe(false);
  });
});
