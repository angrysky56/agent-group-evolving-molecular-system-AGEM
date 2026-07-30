import { describe, expect, it } from "vitest";
import {
  evaluateDiscourseTieBreaker,
  type DiscoursePilotFixture,
} from "./discourse-ordering-pilot.js";

const fixtures: DiscoursePilotFixture[] = Array.from(
  { length: 8 },
  (_, index) => ({
    id: `paired-${index + 1}`,
    edus: [
      { id: "sat", role: "satellite", relation: "elaboration" },
      // Includes condition/exception cases that RST often makes satellites;
      // they receive non-zero weight and are never pruned.
      {
        id: "decisive",
        role: index % 2 === 0 ? "nucleus" : "satellite",
        relation: index % 2 === 0 ? "evidence" : "exception",
      },
    ],
    candidates: [
      {
        id: "a-invalid",
        editCount: 1,
        exactGlossaryReuse: true,
        sourceSpanDistance: 5,
        eduIds: ["sat"],
        counterfactuallyValid: false,
      },
      {
        id: "z-valid",
        editCount: 1,
        exactGlossaryReuse: true,
        sourceSpanDistance: 5,
        eduIds: ["decisive"],
        counterfactuallyValid: true,
      },
    ],
  }),
);

describe("discourse ordering pilot", () => {
  it("uses discourse only as a non-pruning final tie-breaker", () => {
    const report = evaluateDiscourseTieBreaker(fixtures);
    expect(report).toMatchObject({
      fixtures: 8,
      validCandidateRecallBaseline: 1,
      validCandidateRecallDiscourse: 1,
      falsePruned: 0,
    });
    expect(report.meanEvaluationsBeforeValidDiscourse).toBeLessThan(
      report.meanEvaluationsBeforeValidBaseline!,
    );
    expect(report.recommendation).toBe("keep-soft-tiebreaker");
  });
});
